/**
 * Budget Tracker — token budget tracking for team/subagent execution.
 *
 * Tracks token usage with configurable warning (default 80%) and abort
 * (default 95%) thresholds. Provides spent(), remaining(), warning(),
 * exhausted(), and createAbortSignal() for integration with team-runner.
 *
 * @file src/runtime/budget-tracker.ts
 */

import { EventEmitter } from "node:events";

/** Budget configuration passed to TeamBudgetTracker constructor. */
export interface BudgetConfig {
  /** Total token budget for the run. */
  total: number;
  /** Warning threshold as fraction of total (default: 0.8 = 80%). */
  warningThreshold?: number;
  /** Abort threshold as fraction of total (default: 0.95 = 95%). */
  abortThreshold?: number;
}

/** Internal phase-level accounting for trackUsage breakdown. */
interface PhaseUsage {
  phaseName: string;
  tokens: number;
  startTime: number;
}

/** Public usage record returned by trackUsage. */
export interface BudgetUsageRecord {
  /** Total tokens spent after this update. */
  totalSpent: number;
  /** Tokens added in this update. */
  delta: number;
  /** Warning state after this update. */
  isWarning: boolean;
  /** Exhausted state after this update. */
  isExhausted: boolean;
}

/** Event emitted when budget crosses thresholds. */
export interface BudgetEvent {
  type: "budget:warning" | "budget:exhausted";
  budget: BudgetSnapshot;
}

/** Snapshot of budget state for event payloads. */
export interface BudgetSnapshot {
  total: number;
  spent: number;
  remaining: number;
  percentUsed: number;
}

/**
 * TeamBudgetTracker tracks token usage against a configurable budget.
 *
 * @example
 * ```typescript
 * const tracker = new TeamBudgetTracker({ total: 100000 });
 * tracker.trackUsage(5000);
 * console.log(tracker.spent()); // 5000
 * console.log(tracker.warning()); // false (50% of 100k)
 * ```
 */
export class TeamBudgetTracker extends EventEmitter {
  private used = 0;
  private readonly total: number;
  private readonly warningThreshold: number;
  private readonly abortThreshold: number;
  private phaseUsage: PhaseUsage[] = [];
  private warningEmitted = false;
  private exhaustedEmitted = false;
  private abortController: AbortController | null = null;
  private abortInterval: NodeJS.Timeout | null = null;

  /**
   * Create a new budget tracker.
   * @param config - Budget configuration with total and optional thresholds.
   */
  constructor(config: BudgetConfig) {
    super();
    this.total = config.total;
    this.warningThreshold = config.warningThreshold ?? 0.8;
    this.abortThreshold = config.abortThreshold ?? 0.95;
  }

  /**
   * Total budget tokens.
   */
  get totalBudget(): number {
    return this.total;
  }

  /**
   * Get total tokens spent.
   */
  spent(): number {
    return this.used;
  }

  /**
   * Get remaining tokens.
   */
  remaining(): number {
    return this.total - this.used;
  }

  /**
   * Percentage used as decimal (0-1).
   */
  percentUsed(): number {
    return this.total > 0 ? this.used / this.total : 0;
  }

  /**
   * Check if usage has crossed the warning threshold.
   */
  warning(): boolean {
    return this.percentUsed() >= this.warningThreshold;
  }

  /**
   * Check if usage has crossed the abort threshold.
   */
  exhausted(): boolean {
    return this.percentUsed() >= this.abortThreshold;
  }

  /**
   * Check if both warning and exhausted events have been emitted for current usage.
   */
  isWarningEmitted(): boolean {
    return this.warningEmitted;
  }

  /**
   * Check if exhausted event has been emitted.
   */
  isExhaustedEmitted(): boolean {
    return this.exhaustedEmitted;
  }

  /**
   * Track token usage and emit threshold-crossed events.
   *
   * @param tokens - Number of tokens to add to usage.
   * @param phaseName - Optional phase name for breakdown tracking.
   * @returns BudgetUsageRecord with updated totals and thresholds.
   */
  trackUsage(tokens: number, phaseName?: string): BudgetUsageRecord {
    if (tokens < 0) {
      throw new Error("trackUsage: tokens must be non-negative");
    }

    const prevSpent = this.used;
    this.used += tokens;

    // Phase-level tracking for breakdown reporting
    if (phaseName) {
      const existing = this.phaseUsage.find((p) => p.phaseName === phaseName);
      if (existing) {
        existing.tokens += tokens;
      } else {
        this.phaseUsage.push({ phaseName, tokens, startTime: Date.now() });
      }
    }

    const snapshot: BudgetSnapshot = {
      total: this.total,
      spent: this.used,
      remaining: this.remaining(),
      percentUsed: this.percentUsed(),
    };

    // Emit warning event on threshold crossing
    if (this.warning() && !this.warningEmitted) {
      this.warningEmitted = true;
      this.emit("warning", { type: "budget:warning", budget: snapshot } as BudgetEvent);
    }

    // Emit exhausted event on threshold crossing
    if (this.exhausted() && !this.exhaustedEmitted) {
      this.exhaustedEmitted = true;
      this.emit("exhausted", { type: "budget:exhausted", budget: snapshot } as BudgetEvent);
    }

    return {
      totalSpent: this.used,
      delta: tokens,
      isWarning: this.warning(),
      isExhausted: this.exhausted(),
    };
  }

  /**
   * Create an AbortSignal that fires when the budget is exhausted.
   *
   * The signal will be aborted automatically once the abort threshold
   * is crossed. If already exhausted when called, the signal is
   * immediately aborted.
   *
   * @returns AbortSignal that can be passed to subagent execution.
   */
  createAbortSignal(): AbortSignal {
    // If already exhausted, return immediately aborted signal
    if (this.exhausted()) {
      const controller = new AbortController();
      controller.abort(new Error("Budget exhausted before signal creation"));
      return controller.signal;
    }

    // Clear any existing interval before creating new one
    if (this.abortInterval) {
      clearInterval(this.abortInterval);
      this.abortInterval = null;
    }

    // Create controller and set up threshold check
    this.abortController = new AbortController();

    // Store reference for potential external abort
    const tracker = this;

    // Return a signal that checks threshold on each access
    // The actual abort happens once exhausted() first returns true
    const signal = this.abortController.signal;

    // Set up interval check and store the ID for cleanup
    this.abortInterval = setInterval(() => {
      if (tracker.exhausted() && !signal.aborted) {
        tracker.abortController!.abort(
          new Error(`Budget exhausted: ${tracker.spent()}/${tracker.total}`),
        );
        if (tracker.abortInterval) {
          clearInterval(tracker.abortInterval);
          tracker.abortInterval = null;
        }
      }
    }, 1000);

    // Clean up interval when signal is aborted
    const cleanup = (): void => {
      if (tracker.abortInterval) {
        clearInterval(tracker.abortInterval);
        tracker.abortInterval = null;
      }
    };
    signal.addEventListener("abort", cleanup, { once: true });

    return signal;
  }

  /**
   * Get phase-level usage breakdown.
   * @returns Array of phase usage records.
   */
  getPhaseBreakdown(): { phaseName: string; tokens: number }[] {
    return this.phaseUsage.map((p) => ({
      phaseName: p.phaseName,
      tokens: p.tokens,
    }));
  }

  /**
   * Reset usage for re-use (e.g., in testing or recovery scenarios).
   * Does not reset emitted flags — use resetAll() for full reset.
   */
  resetUsage(): void {
    this.used = 0;
    this.phaseUsage = [];
  }

  /**
   * Full reset including emitted flags.
   */
  resetAll(): void {
    this.used = 0;
    this.phaseUsage = [];
    this.warningEmitted = false;
    this.exhaustedEmitted = false;
    this.abortController = null;
    if (this.abortInterval) {
      clearInterval(this.abortInterval);
      this.abortInterval = null;
    }
  }

  /**
   * Get current snapshot of budget state.
   */
  snapshot(): BudgetSnapshot {
    return {
      total: this.total,
      spent: this.used,
      remaining: this.remaining(),
      percentUsed: this.percentUsed(),
    };
  }

  /**
   * Dispose of resources (EventEmitter listeners, timers).
   * Call this when the tracker is no longer needed.
   */
  dispose(): void {
    this.removeAllListeners();
    if (this.abortInterval) {
      clearInterval(this.abortInterval);
      this.abortInterval = null;
    }
    this.abortController = null;
    this.used = 0;
    this.phaseUsage = [];
    this.warningEmitted = false;
    this.exhaustedEmitted = false;
  }
}

/**
 * Create a BudgetConfig with reasonable defaults.
 * @param total - Total token budget.
 * @param warningThreshold - Warning threshold (default 0.8).
 * @param abortThreshold - Abort threshold (default 0.95).
 */
export function createBudgetConfig(
  total: number,
  warningThreshold = 0.8,
  abortThreshold = 0.95,
): BudgetConfig {
  return { total, warningThreshold, abortThreshold };
}

/**
 * Check if a budget config is valid.
 * @param config - Budget configuration to validate.
 */
export function validateBudgetConfig(config: BudgetConfig): { valid: boolean; error?: string } {
  if (typeof config.total !== "number" || config.total <= 0) {
    return { valid: false, error: "total must be a positive number" };
  }
  const warning = config.warningThreshold ?? 0.8;
  const abort = config.abortThreshold ?? 0.95;
  if (warning < 0 || warning > 1) {
    return { valid: false, error: "warningThreshold must be between 0 and 1" };
  }
  if (abort < 0 || abort > 1) {
    return { valid: false, error: "abortThreshold must be between 0 and 1" };
  }
  if (warning >= abort) {
    return { valid: false, error: "warningThreshold must be less than abortThreshold" };
  }
  return { valid: true };
}