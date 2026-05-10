/**
 * Auto-resume controller with settle window — prevents premature context injection
 * by waiting for Pi's setTimeout(0) + setTimeout(100) to drain before resuming.
 *
 * Distilled from pi-autoresearch's auto-resume / settle-window pattern.
 */

/** Time to wait before auto-resuming (ms). Outlasts Pi's setTimeout(0) + setTimeout(100). */
export const SETTLE_WINDOW_MS = 800;

/** Maximum number of auto-resume turns before forcing a stop. */
export const MAX_AUTORESUME_TURNS = 20;

/**
 * Controller for scheduling auto-resume actions with a settle window.
 *
 * The settle window ensures that pending async operations (e.g., Pi's
 * internal setTimeout(0) and setTimeout(100) callbacks) have completed
 * before the resume callback fires.
 */
export class AutoResumeController {
	private timerId: ReturnType<typeof setTimeout> | null = null;
	private turnCount = 0;
	private cancelled = false;

	/**
	 * Get the current auto-resume turn count.
	 */
	get currentTurnCount(): number {
		return this.turnCount;
	}

	/**
	 * Get the maximum allowed auto-resume turns.
	 */
	get maxTurns(): number {
		return MAX_AUTORESUME_TURNS;
	}

	/**
	 * Schedule an auto-resume callback after the settle window elapses.
	 *
	 * If a resume is already pending, it is cancelled first (debounce behavior).
	 * If the turn limit has been reached, the callback is not scheduled.
	 *
	 * @param message - Description of why the resume is being scheduled
	 * @param callback - Function to call after the settle window
	 */
	scheduleResume(message: string, callback: () => void): void {
		// Cancel any existing pending resume
		this.cancelResume();

		// Enforce turn limit
		if (this.turnCount >= MAX_AUTORESUME_TURNS) {
			return;
		}

		this.cancelled = false;
		this.turnCount++;

		this.timerId = setTimeout(() => {
			if (!this.cancelled) {
				this.timerId = null;
				callback();
			}
		}, SETTLE_WINDOW_MS);

		// Prevent the timer from keeping the process alive
		if (this.timerId && typeof this.timerId === "object" && "unref" in this.timerId) {
			this.timerId.unref();
		}
	}

	/**
	 * Cancel any pending auto-resume.
	 */
	cancelResume(): void {
		if (this.timerId !== null) {
			clearTimeout(this.timerId);
			this.timerId = null;
		}
		this.cancelled = true;
	}

	/**
	 * Check whether an auto-resume is currently pending.
	 */
	hasPendingResume(): boolean {
		return this.timerId !== null;
	}

	/**
	 * Reset the turn counter. Called when a new agent starts processing
	 * to allow a fresh set of auto-resume turns.
	 */
	resetTurnCount(): void {
		this.turnCount = 0;
		this.cancelled = false;
	}
}
