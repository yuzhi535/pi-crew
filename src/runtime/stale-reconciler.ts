import * as fs from "node:fs";
import * as path from "node:path";
import type { TeamRunManifest, TeamTaskState } from "../state/types.ts";
import { recordFromTask, upsertCrewAgent } from "./crew-agent-records.ts";
import { checkProcessLiveness } from "./process-status.ts";

/**
 * Result of reconciling a single stale run.
 */
export interface ReconcileResult {
	runId: string;
	/** What was found and what action was taken */
	verdict:
		| "healthy"
		| "result_exists"
		| "pid_dead"
		| "pid_alive_stale"
		| "no_status";
	/** Whether repair was applied */
	repaired: boolean;
	/** Human-readable detail */
	detail: string;
	/** Repaired task state, returned to a locked caller for persistence. */
	repairedTasks?: TeamTaskState[];
}

const STALE_ALIVE_PID_MS = 24 * 60 * 60 * 1000; // 24 hours
const ACTIVE_EVIDENCE_TTL_MS = 5 * 60 * 1000;
/** For no-PID runs, repair when ALL running tasks have heartbeat stale beyond this threshold. */
const NO_PID_HEARTBEAT_STALE_MS = 5 * 60 * 1000; // 5 minutes — same as heartbeat-gradient deadMs

/**
 * Phase 1: Check if a result file already exists for the run.
 * If so, the run completed but status wasn't updated — repair it.
 */
function checkResultFile(
	manifest: TeamRunManifest,
	tasks: TeamTaskState[],
): { found: boolean; repaired: boolean } {
	// Check if all tasks already have terminal status (result was written but manifest wasn't updated)
	const allTerminal =
		tasks.length > 0 &&
		tasks.every(
			(t) =>
				t.status === "completed" ||
				t.status === "failed" ||
				t.status === "cancelled" ||
				t.status === "skipped" ||
				t.status === "needs_attention",
		);
	if (allTerminal) {
		// Sync agent records even when tasks are already terminal
		// (e.g., a previous reconcile fixed tasks but crashed before updating agents)
		for (const task of tasks) {
			try {
				upsertCrewAgent(
					manifest,
					recordFromTask(manifest, task, "scaffold"),
				);
			} catch {
				/* non-critical */
			}
		}
		return { found: true, repaired: false };
	}
	return { found: false, repaired: false };
}

/**
 * Phase 2: Check PID liveness.
 * Uses process.kill(pid, 0) for the authoritative check, but also checks
 * the heartbeat file as corroborating evidence. If a heartbeat was recently
 * written, treat the PID as alive even if process.kill returns false
 * (handles SIGKILL race where PID hasn't been recycled yet).
 */
function checkPidLiveness(
	pid: number | undefined,
	stateRoot?: string,
): {
	alive: boolean;
	detail: string;
} {
	if (pid === undefined || !Number.isInteger(pid) || pid <= 0) {
		return { alive: false, detail: "no pid recorded" };
	}
	const liveness = checkProcessLiveness(pid);
	// If process is alive per kill(0), we're done.
	if (liveness.alive) return { alive: true, detail: liveness.detail };
	// Process is dead per kill(0). Check heartbeat as corroborating evidence.
	if (stateRoot) {
		const heartbeatPath = path.join(stateRoot, "heartbeat.json");
		try {
			if (fs.existsSync(heartbeatPath)) {
				const hb = JSON.parse(
					fs.readFileSync(heartbeatPath, "utf-8"),
				) as { pid?: number; at?: number };
				if (hb?.pid === pid && hb?.at) {
					const ageMs = Date.now() - hb.at;
					// Heartbeat written < 5 min ago → process was alive recently.
					// Don't repair yet; let the next reconciliation cycle catch it.
					if (ageMs < 5 * 60_000) {
						return {
							alive: true,
							detail: `process dead but heartbeat ${Math.round(ageMs / 1000)}s old`,
						};
					}
				}
			}
		} catch {
			/* ignore — best-effort */
		}
	}
	return { alive: liveness.alive, detail: liveness.detail };
}

/**
 * Phase 3: For dead PIDs, repair immediately.
 * For alive PIDs, only mark stale if status hasn't updated in STALE_ALIVE_PID_MS.
 */
function evaluateStaleness(
	manifest: TeamRunManifest,
	pidAlive: boolean,
	now: number,
): { stale: boolean; reason: string } {
	if (!pidAlive) {
		return { stale: true, reason: "pid_dead" };
	}
	const updatedAt = new Date(manifest.updatedAt).getTime();
	if (!Number.isFinite(updatedAt)) {
		return { stale: false, reason: "updated_at_invalid" };
	}
	if (now - updatedAt > STALE_ALIVE_PID_MS) {
		return {
			stale: true,
			reason: `alive_but_stale_${Math.round((now - updatedAt) / 3600_000)}h`,
		};
	}
	return { stale: false, reason: "alive_and_recent" };
}

function hasRecentActiveEvidence(tasks: TeamTaskState[], now: number): boolean {
	return tasks.some((task) => {
		if (task.status !== "running" && task.status !== "waiting")
			return false;
		const heartbeatAt = task.heartbeat?.lastSeenAt
			? new Date(task.heartbeat.lastSeenAt).getTime()
			: Number.NaN;
		if (
			task.heartbeat?.alive !== false &&
			Number.isFinite(heartbeatAt) &&
			now - heartbeatAt <= ACTIVE_EVIDENCE_TTL_MS
		)
			return true;
		const activityAt = task.agentProgress?.lastActivityAt
			? new Date(task.agentProgress.lastActivityAt).getTime()
			: Number.NaN;
		return (
			Number.isFinite(activityAt) &&
			now - activityAt <= ACTIVE_EVIDENCE_TTL_MS
		);
	});
}

/**
 * For no-PID runs: check if ALL running tasks have heartbeats stale beyond
 * the no-PID heartbeat threshold. This detects zombie tasks where the worker
 * process died but no PID was recorded (e.g. live-session /tmp/ workspaces).
 * Tasks with no heartbeat AND no agent progress are considered NOT stale
 * (they may be newly spawned and haven't reported yet).
 */
function allRunningTasksHeartbeatStale(
	tasks: TeamTaskState[],
	now: number,
): boolean {
	const runningTasks = tasks.filter(
		(t) => t.status === "running" || t.status === "waiting",
	);
	if (runningTasks.length === 0) return false;
	return runningTasks.every((task) => {
		const heartbeatAt = task.heartbeat?.lastSeenAt
			? new Date(task.heartbeat.lastSeenAt).getTime()
			: Number.NaN;
		const activityAt = task.agentProgress?.lastActivityAt
			? new Date(task.agentProgress.lastActivityAt).getTime()
			: Number.NaN;
		// If no heartbeat AND no activity, we can't determine staleness — assume not stale
		if (!Number.isFinite(heartbeatAt) && !Number.isFinite(activityAt))
			return false;
		// If heartbeat is recent enough, not stale
		if (
			Number.isFinite(heartbeatAt) &&
			now - heartbeatAt <= NO_PID_HEARTBEAT_STALE_MS
		)
			return false;
		// If agent progress is recent enough, not stale
		if (
			Number.isFinite(activityAt) &&
			now - activityAt <= NO_PID_HEARTBEAT_STALE_MS
		)
			return false;
		// Both present and both stale → this task is stale
		return true;
	});
}

/**
 * Repair a stale run by marking it as failed and cancelling running tasks.
 */
function repairStaleRun(
	manifest: TeamRunManifest,
	tasks: TeamTaskState[],
	reason: string,
): TeamTaskState[] {
	const now = new Date().toISOString();
	const repairedTasks = tasks.map((task) => {
		if (
			task.status === "running" ||
			task.status === "queued" ||
			task.status === "waiting"
		) {
			return {
				...task,
				status: "cancelled" as const,
				finishedAt: now,
				error: `Stale run reconciled: ${reason}`,
			};
		}
		return task;
	});
	// Update agent records so widget sees cancelled status immediately
	for (const task of repairedTasks) {
		try {
			upsertCrewAgent(
				manifest,
				recordFromTask(manifest, task, "scaffold"),
			);
		} catch {
			/* non-critical */
		}
	}
	return repairedTasks;
}

/**
 * Three-phase stale run reconciliation.
 *
 * 1. Check if result already exists → use it
 * 2. Check PID liveness
 * 3. Dead PID → repair immediately; alive PID → only fail if stale > 24h
 */
export function reconcileStaleRun(
	manifest: TeamRunManifest,
	tasks: TeamTaskState[],
	now = Date.now(),
): ReconcileResult {
	const runId = manifest.runId;

	// Phase 1: Check if results already exist
	const phase1 = checkResultFile(manifest, tasks);
	if (phase1.found) {
		return {
			runId,
			verdict: "result_exists",
			repaired: false,
			detail: "All tasks already terminal — no repair needed",
		};
	}

	// Phase 2: Check PID liveness
	const pid = manifest.async?.pid;
	const pidStatus = checkPidLiveness(pid, manifest.stateRoot);

	if (pidStatus.detail === "no pid recorded") {
		// No async PID may be a foreground/live run. Preserve it if task heartbeat
		// or agent progress proves active work even when manifest.updatedAt is old.
		if (hasRecentActiveEvidence(tasks, now)) {
			return {
				runId,
				verdict: "no_status",
				repaired: false,
				detail: "No PID recorded, but recent task heartbeat/progress exists; not repairing",
			};
		}
		// No PID and no recent activity. If ALL running tasks have stale heartbeats
		// (beyond NO_PID_HEARTBEAT_STALE_MS = 5min), repair immediately — the worker
		// process is dead but we have no PID to check. This handles /tmp/ live-session
		// workspaces where agents exit without calling submit_result.
		if (allRunningTasksHeartbeatStale(tasks, now)) {
			const repaired = repairStaleRun(
				manifest,
				tasks,
				"no_pid_heartbeat_stale",
			);
			return {
				runId,
				verdict: "no_status",
				repaired: true,
				detail: `No PID; all running task heartbeats stale >${Math.round(NO_PID_HEARTBEAT_STALE_MS / 60_000)}min; repaired ${repaired.filter((t) => t.status === "cancelled").length} tasks`,
				repairedTasks: repaired,
			};
		}
		// Fall through: no recent activity but not all tasks stale enough yet.
		// Check the longer STALE_ALIVE_PID_MS threshold for very old runs.
		const updatedAt = new Date(manifest.updatedAt).getTime();
		if (
			Number.isFinite(updatedAt) &&
			now - updatedAt > STALE_ALIVE_PID_MS
		) {
			const repaired = repairStaleRun(manifest, tasks, "no_pid_stale");
			return {
				runId,
				verdict: "no_status",
				repaired: true,
				detail: `No PID; stale ${Math.round((now - updatedAt) / 3600_000)}h; repaired ${repaired.filter((t) => t.status === "cancelled").length} tasks`,
				repairedTasks: repaired,
			};
		}
		return {
			runId,
			verdict: "no_status",
			repaired: false,
			detail: "No PID recorded; not stale enough to repair",
		};
	}

	// Phase 3: Evaluate staleness
	const staleness = evaluateStaleness(manifest, pidStatus.alive, now);
	if (!staleness.stale) {
		return {
			runId,
			verdict: "healthy",
			repaired: false,
			detail: `PID ${pid}: ${pidStatus.detail}, ${staleness.reason}`,
		};
	}

	// Repair
	const repaired = repairStaleRun(manifest, tasks, staleness.reason);
	return {
		runId,
		verdict: pidStatus.alive ? "pid_alive_stale" : "pid_dead",
		repaired: true,
		detail: `PID ${pid}: ${pidStatus.detail}; ${staleness.reason}; repaired ${repaired.filter((t) => t.status === "cancelled").length} tasks`,
		repairedTasks: repaired,
	};
}
