/**
 * workspace-lock.ts — Per-cwd workspace lock with startTime-safe liveness (P1g).
 *
 * RFC: research-findings/goal-workflow/13-VISION-RFC.md v0.5 §P1g + D10.
 *
 * Closes #8 (multi-goal clobber) and the B-2 PID-recycling gap. Each
 * `workspaceMode:"single"` goal acquires this lock for its entire lifetime,
 * serializing concurrent goals that share a cwd.
 *
 * Lockfile location: `<crewRoot>/state/workspace-locks/<sha256(absCwd)>.lock`
 * Lockfile contents: { pid, startTime, heartbeat, goalId, acquiredAt }
 *
 * ─── LIVENESS = stale-reconciler startTime pattern (D10, B-2 fix) ───
 * A lock is STALE iff EITHER:
 *   (a) the recorded pid's CURRENT startTime ≠ the lockfile startTime
 *       (the PID was recycled to a different process), OR
 *   (b) the heartbeat is older than HEARTBEAT_STALE_MS (default 60s)
 *       (the process crashed without exiting / heartbeat stopped).
 *
 * Why NOT child-pi.ts killProcessPid (B-2): killProcessPid uses
 * process.kill(pid, 0) which is PID-only — vulnerable to PID recycling. The
 * startTime + before/after re-verify pattern is TOCTOU-correct.
 *
 * getProcessStartTime is NOT exported from stale-reconciler.ts, so its logic
 * is REPLICATED here (RFC §P1g explicitly permits importing OR replicating).
 * The replication matches stale-reconciler.ts:112 field-for-field.
 *
 * Granularity: per-goal, held for the goal's lifetime (release() on goal end).
 * Contention: default QUEUE (poll until released or stale);
 *             opts.failOnWorkspaceBusy:true → THROW instead of queue.
 */

import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	unlinkSync,
} from "node:fs";
import * as path from "node:path";
import { atomicWriteJson } from "../state/atomic-write.ts";
import { projectCrewRoot, userCrewRoot } from "../utils/paths.ts";

/** Heartbeat staleness threshold (ms). Default 60s per RFC §P1g. */
const DEFAULT_HEARTBEAT_STALE_MS = 60_000;

/** Polling interval while queued waiting for a held lock (ms). */
const DEFAULT_LOCK_POLL_MS = 500;

/**
 * Resolve a pid's process start time in ms, reusing the stale-reconciler
 * pattern (src/runtime/stale-reconciler.ts:112). Returns undefined if the
 * process is gone or /proc is unavailable (non-Linux). The absolute value
 * matters less than its uniqueness per PID lifecycle. Used to detect PID
 * recycling: a recycled PID has a different startTime than the recorded one.
 *
 * Callers (esp. tests) may inject a custom resolver to simulate PID recycling
 * deterministically without spawning real processes.
 */
export type StartTimeResolver = (pid: number) => number | undefined;

export const defaultStartTimeResolver: StartTimeResolver = (pid: number): number | undefined => {
	try {
		const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
		const lastParen = stat.lastIndexOf(")");
		if (lastParen === -1) return undefined;
		const fieldsAfterComm = stat.slice(lastParen + 1).trim().split(/\s+/);
		// starttime is at index 19 (the 20th field after comm) of /proc/<pid>/stat.
		const startTimeClockTicks = Number(fieldsAfterComm[19]);
		if (!Number.isFinite(startTimeClockTicks)) return undefined;
		// Convert clock ticks to ms (~CLK_TCK). Absolute uniqueness is what matters.
		return Math.floor(startTimeClockTicks * 10);
	} catch {
		return undefined;
	}
};

/** Lockfile contents (persisted as JSON). */
export interface WorkspaceLockContents {
	pid: number;
	startTime: number | undefined;
	heartbeat: number;
	goalId: string;
	acquiredAt: string;
}

/**
 * Opaque handle returned by acquireWorkspaceLock. Call release() to free the
 * lock when the goal ends. release() is a no-op if the lock was already
 * reclaimed/re-acquired by another goal (guarded by goalId + pid + startTime).
 */
export interface WorkspaceLockHandle {
	readonly cwd: string;
	readonly goalId: string;
	readonly lockPath: string;
	/** The startTime value written to the lockfile at acquire (release guard). */
	readonly startTime: number | undefined;
	release(): void;
}

export interface AcquireWorkspaceLockOptions {
	/** Throw instead of queue when the workspace is already held (default: queue). */
	failOnWorkspaceBusy?: boolean;
	/** Override the heartbeat-staleness threshold (ms). */
	heartbeatStaleMs?: number;
	/** Override the polling interval while queued (ms). */
	pollMs?: number;
	/** Test injection: override process start time resolution. */
	startTimeResolver?: StartTimeResolver;
	/** Test injection: override current time (ms). Default Date.now(). */
	now?: () => number;
	/** Test injection: override the current pid. Default process.pid. */
	pid?: number;
	/** Abort waiting when this signal aborts. */
	signal?: AbortSignal;
}

/**
 * Resolve the lockfile path for a cwd. Lockfiles live under the project's
 * `.crew/state/workspace-locks/` (or user crew-root fallback) and are named by
 * the sha256 of the absolute cwd to avoid filesystem-unsafe characters and to
 * normalize symlink-equivalent paths.
 */
export function workspaceLockPath(cwd: string): string {
	const absCwd = path.resolve(cwd);
	const crewRoot = projectCrewRoot(absCwd) ?? userCrewRoot();
	const locksDir = path.join(crewRoot, "state", "workspace-locks");
	const hash = createHash("sha256").update(absCwd).digest("hex");
	return path.join(locksDir, `${hash}.lock`);
}

/** Read + parse a lockfile. Returns undefined if missing/corrupt. */
function readLock(lockPath: string): WorkspaceLockContents | undefined {
	if (!existsSync(lockPath)) return undefined;
	try {
		const parsed = JSON.parse(readFileSync(lockPath, "utf-8"));
		if (!parsed || typeof parsed !== "object") return undefined;
		return parsed as WorkspaceLockContents;
	} catch {
		return undefined;
	}
}

/** Write the lockfile atomically (temp+rename+fsync via atomicWriteJson). */
function writeLock(lockPath: string, contents: WorkspaceLockContents): void {
	mkdirSync(path.dirname(lockPath), { recursive: true });
	atomicWriteJson(lockPath, contents);
}

/**
 * Is the lock STALE? RFC §P1g + D10 dual-check:
 *   (a) startTime mismatch → PID recycled to a different process, OR
 *   (b) heartbeat older than heartbeatStaleMs → crash w/o exit / abandoned.
 *
 * On platforms where startTime is unavailable (non-Linux), only the heartbeat
 * check applies (weaker PID-reuse detection — documented platform limitation,
 * matching stale-reconciler.ts).
 */
function isLockStale(
	lock: WorkspaceLockContents,
	resolveStartTime: StartTimeResolver,
	heartbeatStaleMs: number,
	now: number,
): { stale: boolean; reason?: string } {
	// (a) startTime mismatch → PID recycled to a different process.
	if (lock.startTime !== undefined) {
		const currentStartTime = resolveStartTime(lock.pid);
		if (currentStartTime !== undefined && currentStartTime !== lock.startTime) {
			return { stale: true, reason: "pid_recycled" };
		}
		// currentStartTime === undefined: process gone OR /proc unavailable →
		// fall through to the heartbeat check (corroborating evidence).
	}
	// (b) heartbeat older than threshold → crash without exit / abandoned.
	const heartbeatAge = now - lock.heartbeat;
	if (heartbeatAge > heartbeatStaleMs) {
		return { stale: true, reason: "heartbeat_stale" };
	}
	return { stale: false };
}

/**
 * Acquire the workspace lock for `goalId` at `cwd`. If the lock is held by a
 * live goal, the default behavior is QUEUE (poll until released or the holder
 * goes stale); with opts.failOnWorkspaceBusy:true, throws instead.
 *
 * Stale locks (PID recycled or heartbeat expired) are reclaimed transparently.
 *
 * The returned handle's release() deletes the lockfile ONLY if it still
 * belongs to this goal+pid+startTime — so a stale handle cannot clobber a
 * lock reclaimed and re-acquired by another goal after this goal went stale.
 *
 * In-process serialization: the read→stale-check→write sequence is
 * synchronous within one event-loop tick, so concurrent in-process acquires
 * cannot both observe a free lock and both write (no interleave between the
 * sync read and sync write).
 */
export async function acquireWorkspaceLock(
	cwd: string,
	goalId: string,
	opts: AcquireWorkspaceLockOptions = {},
): Promise<WorkspaceLockHandle> {
	const lockPath = workspaceLockPath(cwd);
	const resolveStartTime = opts.startTimeResolver ?? defaultStartTimeResolver;
	const heartbeatStaleMs = opts.heartbeatStaleMs ?? DEFAULT_HEARTBEAT_STALE_MS;
	const pollMs = opts.pollMs ?? DEFAULT_LOCK_POLL_MS;
	const now = opts.now ?? Date.now;
	const pid = opts.pid ?? process.pid;
	const writtenStartTime = resolveStartTime(pid);

	while (true) {
		// Poll-loop: re-check the lock each tick until free/stale or aborted.
		if (opts.signal?.aborted) {
			throw new Error(
				`workspace lock acquisition aborted for goal ${goalId} (cwd=${cwd})`,
			);
		}
		const existing = readLock(lockPath);
		if (
			!existing ||
			isLockStale(existing, resolveStartTime, heartbeatStaleMs, now()).stale
		) {
			// Claim the lock (covers both no-lock and stale-lock cases).
			const contents: WorkspaceLockContents = {
				pid,
				startTime: writtenStartTime,
				heartbeat: now(),
				goalId,
				acquiredAt: new Date(now()).toISOString(),
			};
			writeLock(lockPath, contents);
			return {
				cwd,
				goalId,
				lockPath,
				startTime: writtenStartTime,
				release(): void {
					safeRelease(lockPath, goalId, pid, writtenStartTime);
				},
			};
		}
		// Lock is held and live.
		if (opts.failOnWorkspaceBusy) {
			throw new Error(
				`workspace busy: cwd=${cwd} held by goalId=${existing!.goalId} (pid=${existing!.pid})`,
			);
		}
		// Queue: wait for the next poll interval, then re-check.
		await sleepOrAbort(pollMs, opts.signal);
	}
}

/**
 * Delete the lockfile at `lockPath` only if it still belongs to
 * (goalId, pid, startTime). A stale handle (whose lock was reclaimed and
 * re-acquired by another goal) must NOT delete the new owner's lock.
 */
function safeRelease(
	lockPath: string,
	goalId: string,
	pid: number,
	writtenStartTime: number | undefined,
): void {
	try {
		const current = readLock(lockPath);
		if (
			current &&
			current.goalId === goalId &&
			current.pid === pid &&
			current.startTime === writtenStartTime
		) {
			unlinkSync(lockPath);
		}
	} catch {
		/* best-effort — release must never throw into a finally block */
	}
}

/** Sleep that resolves after `ms`, or rejects early if `signal` aborts. */
function sleepOrAbort(ms: number, signal?: AbortSignal): Promise<void> {
	if (!signal) return new Promise<void>((r) => setTimeout(r, ms));
	return new Promise<void>((resolve, reject) => {
		const timer = setTimeout(resolve, ms);
		signal.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				reject(new Error("workspace lock acquisition aborted"));
			},
			{ once: true },
		);
	});
}

/**
 * Reclaim all stale locks under `dir` (the workspace-locks directory). Returns
 * the list of reclaimed lock paths. Stale = PID recycled OR heartbeat older
 * than threshold. Corrupt/unreadable locks are also reclaimed.
 *
 * Useful as a startup or periodic sweep to clear locks left by crashed
 * processes before any goal tries to acquire them.
 */
export function reclaimStaleLocks(
	dir: string,
	opts: {
		heartbeatStaleMs?: number;
		startTimeResolver?: StartTimeResolver;
		now?: () => number;
	} = {},
): string[] {
	const resolveStartTime = opts.startTimeResolver ?? defaultStartTimeResolver;
	const heartbeatStaleMs = opts.heartbeatStaleMs ?? DEFAULT_HEARTBEAT_STALE_MS;
	const now = opts.now ?? Date.now;
	const reclaimed: string[] = [];
	if (!existsSync(dir)) return reclaimed;
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return reclaimed;
	}
	for (const entry of entries) {
		if (!entry.endsWith(".lock")) continue;
		const lockPath = path.join(dir, entry);
		const lock = readLock(lockPath);
		if (!lock) {
			// Corrupt/empty — reclaim.
			try {
				unlinkSync(lockPath);
				reclaimed.push(lockPath);
			} catch {
				/* best-effort */
			}
			continue;
		}
		if (isLockStale(lock, resolveStartTime, heartbeatStaleMs, now()).stale) {
			try {
				unlinkSync(lockPath);
				reclaimed.push(lockPath);
			} catch {
				/* best-effort */
			}
		}
	}
	return reclaimed;
}
