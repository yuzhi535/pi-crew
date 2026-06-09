import * as fs from "node:fs";
import type { TaskCheckpointState, TeamRunManifest, TeamTaskState } from "../../state/types.ts";
import { loadRunManifestById, saveRunTasks } from "../../state/state-store.ts";
import { recordFromTask, upsertCrewAgent } from "../crew-agent-records.ts";
import { logInternalError } from "../../utils/internal-error.ts";
import { withRunLockSync } from "../../state/locks.ts";

export function updateTask(tasks: TeamTaskState[], updated: TeamTaskState): TeamTaskState[] {
	return tasks.map((task) => task.id === updated.id ? updated : task);
}

/**
 * Persist a single task update using compare-and-swap under the run lock.
 *
 * Problem: The naive read-merge-write pattern is vulnerable to a read-modify-write
 * race. When two parallel task completions race:
 *   1. Task A loads tasks [A(running), B(running)], writes [A(completed), B(running)]
 *   2. Task B loads [A(running), B(running)] (stale, before A's write), writes [A(running), B(completed)]
 *   Result: Task A's completed status is clobbered.
 *
 * Solution: Use mtime-based CAS under the run lock. Before writing, stat the tasks file
 * to record its mtime. After merging, re-stat — if mtime changed, another writer
 * committed first; retry with the fresh state. This is O(retry) under contention but
 * converges in the normal single-writer case.
 *
 * @param checkpointPhase - Optional checkpoint phase to include in the task state alongside the update.
 */
export function persistSingleTaskUpdate(manifest: TeamRunManifest, fallbackTasks: TeamTaskState[], updated: TeamTaskState, checkpointPhase?: TaskCheckpointState["phase"]): TeamTaskState[] {
	let baseMtime = 0;
	try {
		baseMtime = fs.statSync(manifest.tasksPath).mtimeMs;
	} catch {
		// File doesn't exist yet — baseMtime=0 means "anything is fine"
		baseMtime = 0;
	}

	let merged: TeamTaskState[] | undefined;

	// Build the task with optional checkpoint phase
	const taskWithCheckpoint = checkpointPhase
		? { ...updated, checkpoint: { phase: checkpointPhase, updatedAt: new Date().toISOString() } }
		: updated;

	try {
		return withRunLockSync(manifest, () => {
			retryLoop: for (let attempt = 0; attempt < 100; attempt++) {
				const latest = loadRunManifestById(manifest.cwd, manifest.runId)?.tasks ?? fallbackTasks;
				merged = updateTask(latest, taskWithCheckpoint);

				// Re-stat to detect concurrent writes
				let currentMtime: number;
				try {
					currentMtime = fs.statSync(manifest.tasksPath).mtimeMs;
				} catch {
					currentMtime = 0;
				}

				if (currentMtime !== baseMtime) {
					// Another writer committed — their update is in latest, re-merge on top
					baseMtime = currentMtime;
					continue retryLoop;
				}

				// No concurrent writer — check that our merged result is based on the
				// same base we observed (no intermediate writer between our load and check)
				const recheckMtime = fs.statSync(manifest.tasksPath).mtimeMs;
				if (recheckMtime !== baseMtime) {
					baseMtime = recheckMtime;
					continue retryLoop;
				}

				// Final pre-write mtime check to catch any concurrent writer that completed
				// between the recheck and saveRunTasks
				let preWriteMtime: number;
				try {
					preWriteMtime = fs.statSync(manifest.tasksPath).mtimeMs;
				} catch {
					preWriteMtime = 0;
				}
				if (preWriteMtime !== baseMtime) {
					// Another writer committed — retry
					baseMtime = preWriteMtime;
					continue retryLoop;
				}

				break retryLoop;
			}

			if (merged === undefined) {
				logInternalError("persistSingleTaskUpdate", new Error("failed to converge after 50 attempts"));
				throw new Error("persistSingleTaskUpdate: failed to converge after 50 attempts");
			}

			try {
				saveRunTasks(manifest, merged);
			} catch (err) {
				logInternalError("persistSingleTaskUpdate", err);
				throw err;
			}
			return merged;
		});
	} catch (err) {
		if (merged === undefined) {
			logInternalError("persistSingleTaskUpdate", err);
		}
		throw err;
	}
}

export function checkpointTask(manifest: TeamRunManifest, tasks: TeamTaskState[], task: TeamTaskState, phase: TaskCheckpointState["phase"], childPid?: number): { task: TeamTaskState; tasks: TeamTaskState[] } {
	const checkpoint: TaskCheckpointState = { phase, updatedAt: new Date().toISOString(), ...(childPid ? { childPid } : task.checkpoint?.childPid ? { childPid: task.checkpoint.childPid } : {}) };
	const nextTask = { ...task, checkpoint };
	const nextTasks = persistSingleTaskUpdate(manifest, updateTask(tasks, nextTask), nextTask);
	try {
		upsertCrewAgent(manifest, recordFromTask(manifest, nextTask, "child-process"));
	} catch (err) {
		logInternalError("checkpointTask", err);
	}
	return { task: nextTask, tasks: nextTasks };
}
