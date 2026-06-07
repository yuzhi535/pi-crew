/**
 * Parent liveness guard for pi-crew worker processes.
 *
 * Workers call `startParentGuard(parentPid)` at startup. A lightweight
 * interval checks if the parent PID is still alive. When the parent dies
 * (SIGKILL, crash, power loss, terminal close), the worker self-terminates
 * immediately — no sentinel process needed.
 *
 * Note: `process.kill(pid, 0)` works on both Unix and Windows in Node.js
 * for checking process existence. On Windows, it may throw for processes
 * owned by other users (permission error), but correctly detects dead PIDs.
 *
 * Usage in worker entry points:
 * ```ts
 * const parentPid = Number(process.env.PI_CREW_PARENT_PID);
 * if (parentPid > 0) startParentGuard(parentPid);
 * ```
 */

/**
 * Poll interval for parent liveness checks (in milliseconds).
 * Default: 3000ms (3 seconds). A parent killed by SIGKILL is only detected
 * at the next poll tick.
 *
 * WARNING: Values below 1000ms significantly increase overhead for large
 * numbers of parallel workers, since each poll issues a process.kill(pid, 0)
 * syscall per worker. Only tune this if immediate detection is critical.
 */
const POLL_INTERVAL_MS = Number(process.env.PI_CREW_PARENT_GUARD_INTERVAL_MS) || 3_000;

let guardInterval: ReturnType<typeof setInterval> | undefined;

function isPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function selfTerminate(parentPid: number): never {
	// Best-effort: try to log why we're dying
	try {
		if (typeof process.stderr?.write === "function") {
			process.stderr.write(`[pi-crew] Parent process ${parentPid} is dead — self-terminating worker ${process.pid}\n`);
		}
	} catch {
		// Ignore
	}
	process.exit(124); // 124 = "parent died" exit code
}

/**
 * Start a lightweight poll that checks if the parent process is still alive.
 * If the parent dies, this worker exits immediately with code 124.
 *
 * FIX: Removed unref() — the guard interval MUST keep the event loop alive
 * to prevent premature worker exit when the parent is still alive but the
 * worker has no other pending work (LLM calls, timers, I/O). Without this,
 * a worker in pure CPU wait could exit even though its parent is alive.
 */
export function startParentGuard(parentPid: number): void {
	if (!parentPid || !Number.isFinite(parentPid) || parentPid <= 0) return;

	// Immediate check — if parent is already dead, don't even start
	if (!isPidAlive(parentPid)) {
		selfTerminate(parentPid);
	}

	guardInterval = setInterval(() => {
		if (!isPidAlive(parentPid)) {
			if (guardInterval) clearInterval(guardInterval);
			selfTerminate(parentPid);
		}
	}, POLL_INTERVAL_MS);

	// NOTE: Intentionally NOT calling guardInterval.unref() here.
	// The watchdog timer must keep the event loop alive to ensure the worker
	// doesn't exit while the parent is alive. If other work (child processes,
	// timers, I/O) keeps the loop alive, that's fine — the guard runs as a
	// side effect. If no other work exists, the guard is the only thing
	// keeping the process alive, and that's by design.
}

/**
 * Stop the parent guard. Called when the worker finishes normally
 * and doesn't need to watch the parent anymore.
 */
export function stopParentGuard(): void {
	if (guardInterval) {
		clearInterval(guardInterval);
		guardInterval = undefined;
	}
}
