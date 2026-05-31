/**
 * Phase Tracker — marks phase transitions with timestamps and metrics.
 *
 * Tracks workflow phases (assessment, implementation, verification, etc.)
 * with start/complete/skip lifecycle and phase-level metrics.
 *
 * @file src/runtime/phase-tracker.ts
 */

import { EventEmitter } from "node:events";

/** Phase status. */
export type PhaseStatus = "active" | "completed" | "skipped" | "failed";

/** Metrics collected for a phase. */
export interface PhaseMetrics {
  /** Number of tasks completed in this phase. */
  tasksCompleted?: number;
  /** Number of tasks failed in this phase. */
  tasksFailed?: number;
  /** Total tokens used in this phase. */
  tokensUsed?: number;
  /** Number of subagents spawned in this phase. */
  subagentsSpawned?: number;
  /** Custom metadata key-value pairs. */
  custom?: Record<string, unknown>;
}

/** A tracked phase. */
export interface Phase {
  /** Unique phase name/identifier. */
  name: string;
  /** ISO timestamp when phase started. */
  startTime: string;
  /** ISO timestamp when phase ended (if ended). */
  endTime?: string;
  /** Duration in milliseconds (if ended). */
  durationMs?: number;
  /** Current phase status. */
  status: PhaseStatus;
  /** Collected metrics for this phase. */
  metrics?: PhaseMetrics;
  /** Order index (0-based). */
  index: number;
}

/** Event emitted on phase lifecycle changes. */
export interface PhaseLifecycleEvent {
  type: "phase:started" | "phase:completed" | "phase:skipped" | "phase:failed";
  phase: Phase;
}

/** Default empty metrics. */
function emptyMetrics(): PhaseMetrics {
  return {
    tasksCompleted: 0,
    tasksFailed: 0,
    tokensUsed: 0,
    subagentsSpawned: 0,
  };
}

/**
 * PhaseTracker manages workflow phase lifecycle.
 *
 * @example
 * ```typescript
 * const tracker = new PhaseTracker();
 * tracker.start("assessment");
 * // ... do work ...
 * tracker.complete("assessment", { tasksCompleted: 5, tokensUsed: 12000 });
 * tracker.start("implementation");
 * ```
 */
export class PhaseTracker extends EventEmitter {
  private phases: Phase[] = [];
  private currentPhaseName: string | null = null;
  private phaseMetrics: Map<string, PhaseMetrics> = new Map();

  /**
   * Start a new phase, completing the previous one if any.
   *
   * @param name - Phase name (e.g., "assessment", "implementation").
   * @param metrics - Optional initial metrics for the phase.
   * @returns The started Phase object.
   */
  start(name: string, metrics?: PhaseMetrics): Phase {
    // Complete previous phase before starting new one (only if active)
    if (this.currentPhaseName !== null) {
      this.completeIfActive(this.currentPhaseName);
    }

    const phase: Phase = {
      name,
      startTime: new Date().toISOString(),
      status: "active",
      index: this.phases.length,
      metrics: metrics ?? emptyMetrics(),
    };

    this.phases.push(phase);
    this.currentPhaseName = name;
    this.phaseMetrics.set(name, phase.metrics!);

    const event: PhaseLifecycleEvent = { type: "phase:started", phase };
    this.emit("phase:started", event);
    return phase;
  }

  /**
   * Complete a phase with optional metrics update.
   *
   * @param name - Phase name to complete.
   * @param metrics - Optional metrics to merge/update.
   */
  complete(name: string, metrics?: Partial<PhaseMetrics>): void {
    const phase = this.phases.find((p) => p.name === name);
    if (!phase) {
      throw new Error(`Phase "${name}" not found`);
    }
    if (phase.status !== "active") {
      throw new Error(`Phase "${name}" is not active (status: ${phase.status})`);
    }

    const now = new Date();
    const startMs = new Date(phase.startTime).getTime();
    const endMs = now.getTime();

    phase.endTime = now.toISOString();
    phase.durationMs = endMs - startMs;
    phase.status = "completed";

    // Merge provided metrics with existing
    if (metrics) {
      const existing = this.phaseMetrics.get(name) ?? emptyMetrics();
      phase.metrics = {
        tasksCompleted: metrics.tasksCompleted ?? existing.tasksCompleted,
        tasksFailed: metrics.tasksFailed ?? existing.tasksFailed,
        tokensUsed: metrics.tokensUsed ?? existing.tokensUsed,
        subagentsSpawned: metrics.subagentsSpawned ?? existing.subagentsSpawned,
        custom: { ...existing.custom, ...metrics.custom },
      };
      this.phaseMetrics.set(name, phase.metrics);
    }

    this.emit("phase:completed", { type: "phase:completed", phase } as PhaseLifecycleEvent);
  }

  /**
   * Skip the current active phase without metrics.
   *
   * @param name - Phase name to skip.
   * @param reason - Optional reason for skipping.
   */
  skip(name: string, reason?: string): void {
    const phase = this.phases.find((p) => p.name === name);
    if (!phase) {
      throw new Error(`Phase "${name}" not found`);
    }
    if (phase.status !== "active") {
      throw new Error(`Phase "${name}" is not active (status: ${phase.status})`);
    }

    const now = new Date();
    const startMs = new Date(phase.startTime).getTime();
    const endMs = now.getTime();

    phase.endTime = now.toISOString();
    phase.durationMs = endMs - startMs;
    phase.status = "skipped";

    // Clear current phase since we're done with it
    if (this.currentPhaseName === name) {
      this.currentPhaseName = null;
    }

    this.emit("phase:skipped", { type: "phase:skipped", phase } as PhaseLifecycleEvent);
  }

  /**
   * Mark a phase as failed.
   *
   * @param name - Phase name to fail.
   * @param error - Optional error information.
   */
  fail(name: string, error?: string): void {
    const phase = this.phases.find((p) => p.name === name);
    if (!phase) {
      throw new Error(`Phase "${name}" not found`);
    }
    if (phase.status !== "active") {
      throw new Error(`Phase "${name}" is not active (status: ${phase.status})`);
    }

    const now = new Date();
    const startMs = new Date(phase.startTime).getTime();
    const endMs = now.getTime();

    phase.endTime = now.toISOString();
    phase.durationMs = endMs - startMs;
    phase.status = "failed";

    if (error) {
      const existing = this.phaseMetrics.get(name) ?? emptyMetrics();
      phase.metrics = { ...existing, custom: { ...existing.custom, error } };
      this.phaseMetrics.set(name, phase.metrics);
    }

    // Clear current phase since we're done with it
    if (this.currentPhaseName === name) {
      this.currentPhaseName = null;
    }

    this.emit("phase:failed", { type: "phase:failed", phase } as PhaseLifecycleEvent);
  }

  /**
   * Complete a phase only if it is currently active. Does not throw if the
   * phase is already completed, skipped, or failed.
   *
   * @param name - Phase name to complete.
   * @param metrics - Optional metrics to merge/update.
   */
  completeIfActive(name: string, metrics?: Partial<PhaseMetrics>): void {
    const phase = this.phases.find((p) => p.name === name);
    if (phase && phase.status === "active") {
      this.complete(name, metrics);
    }
  }

  /**
   * Get all phases.
   * @returns Copy of phases array.
   */
  getPhases(): Phase[] {
    return [...this.phases];
  }

  /**
   * Get phases filtered by status.
   * @param status - Status to filter by.
   * @returns Filtered phases.
   */
  getPhasesByStatus(status: PhaseStatus): Phase[] {
    return this.phases.filter((p) => p.status === status);
  }

  /**
   * Get the current active phase.
   * @returns Current phase or null if none active.
   */
  getCurrentPhase(): Phase | null {
    return this.phases.find((p) => p.status === "active") ?? null;
  }

  /**
   * Get a specific phase by name.
   * @param name - Phase name.
   * @returns Phase or undefined.
   */
  getPhase(name: string): Phase | undefined {
    return this.phases.find((p) => p.name === name);
  }

  /**
   * Get metrics for a phase.
   * @param name - Phase name.
   * @returns Metrics or undefined.
   */
  getMetrics(name: string): PhaseMetrics | undefined {
    return this.phaseMetrics.get(name);
  }

  /**
   * Update metrics for the current phase.
   * @param updates - Partial metrics to merge.
   */
  updateCurrentMetrics(updates: Partial<PhaseMetrics>): void {
    if (!this.currentPhaseName) return;
    const existing = this.phaseMetrics.get(this.currentPhaseName) ?? emptyMetrics();
    const updated: PhaseMetrics = {
      tasksCompleted: updates.tasksCompleted ?? existing.tasksCompleted,
      tasksFailed: updates.tasksFailed ?? existing.tasksFailed,
      tokensUsed: updates.tokensUsed ?? existing.tokensUsed,
      subagentsSpawned: updates.subagentsSpawned ?? existing.subagentsSpawned,
      custom: { ...existing.custom, ...updates.custom },
    };
    this.phaseMetrics.set(this.currentPhaseName, updated);
    const phase = this.getPhase(this.currentPhaseName);
    if (phase) {
      phase.metrics = updated;
    }
  }

  /**
   * Add tokens to the current phase's metrics.
   * @param tokens - Number of tokens to add.
   */
  addTokensToCurrent(tokens: number): void {
    if (!this.currentPhaseName) return;
    const existing = this.phaseMetrics.get(this.currentPhaseName) ?? emptyMetrics();
    existing.tokensUsed = (existing.tokensUsed ?? 0) + tokens;
    this.phaseMetrics.set(this.currentPhaseName, existing);
    const phase = this.getPhase(this.currentPhaseName);
    if (phase) {
      phase.metrics = existing;
    }
  }

  /**
   * Get total duration across all completed phases.
   * @returns Total milliseconds or 0.
   */
  totalDuration(): number {
    return this.phases.reduce((sum, p) => sum + (p.durationMs ?? 0), 0);
  }

  /**
   * Get summary statistics for all phases.
   * @returns Summary object.
   */
  summary(): {
    totalPhases: number;
    active: number;
    completed: number;
    skipped: number;
    failed: number;
    totalDurationMs: number;
  } {
    return {
      totalPhases: this.phases.length,
      active: this.phases.filter((p) => p.status === "active").length,
      completed: this.phases.filter((p) => p.status === "completed").length,
      skipped: this.phases.filter((p) => p.status === "skipped").length,
      failed: this.phases.filter((p) => p.status === "failed").length,
      totalDurationMs: this.totalDuration(),
    };
  }

  /**
   * Check if a phase exists.
   * @param name - Phase name.
   * @returns True if phase exists.
   */
  hasPhase(name: string): boolean {
    return this.phases.some((p) => p.name === name);
  }

  /**
   * Reset all phases (for testing or recovery).
   */
  reset(): void {
    this.phases = [];
    this.currentPhaseName = null;
    this.phaseMetrics.clear();
  }

  /**
   * Dispose of resources (EventEmitter listeners).
   * Call this when the tracker is no longer needed.
   */
  dispose(): void {
    this.removeAllListeners();
    this.phases = [];
    this.currentPhaseName = null;
    this.phaseMetrics.clear();
  }
}