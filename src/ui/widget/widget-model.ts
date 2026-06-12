/**
 * Widget data model — fetching, filtering, and caching.
 *
 * Extracted from crew-widget.ts.
 */

import type { TeamRunManifest } from "../../state/types.ts";
import { readCrewAgents } from "../../runtime/crew-agent-records.ts";
import type { CrewAgentRecord } from "../../runtime/crew-agent-runtime.ts";
import { isDisplayActiveRun } from "../../runtime/process-status.ts";
import { listLiveAgents, evictStaleLiveAgentHandles } from "../../runtime/live-agent-manager.ts";
import type { ManifestCache } from "../../runtime/manifest-cache.ts";
import { reconcileAllStaleRuns } from "../../runtime/crash-recovery.ts";
import { listRecentRuns } from "../../extension/run-index.ts";
import type { RunSnapshotCache } from "../snapshot-types.ts";
import type { WidgetRun } from "./widget-types.ts";

let lastStaleReconcileAt = 0;
const STALE_RECONCILE_INTERVAL_MS = 60_000;

function agentsFor(run: TeamRunManifest): CrewAgentRecord[] {
	try {
		return readCrewAgents(run);
	} catch {
		return [];
	}
}

/**
 * Get active widget runs for display.
 */
export function activeWidgetRuns(
	cwd: string,
	manifestCache?: ManifestCache,
	snapshotCache?: RunSnapshotCache,
	preloadedManifests?: TeamRunManifest[],
	workspaceId?: string,
): WidgetRun[] {
	evictStaleLiveAgentHandles();

	const now = Date.now();
	if (now - lastStaleReconcileAt > STALE_RECONCILE_INTERVAL_MS && manifestCache) {
		lastStaleReconcileAt = now;
		try { reconcileAllStaleRuns(cwd, manifestCache); } catch { /* non-critical */ }
	}

	let runs = preloadedManifests ?? (manifestCache ? manifestCache.list(20) : listRecentRuns(cwd, 20));
	if (workspaceId) {
		runs = runs.filter((run) => !run.ownerSessionId || run.ownerSessionId === workspaceId);
	}

	return runs
		.map((run) => {
			try {
				const snapshot = snapshotCache?.get(run.runId);
				return snapshot
					? { run: snapshot.manifest, agents: snapshot.agents, snapshot }
					: { run, agents: agentsFor(run) };
			} catch {
				return { run, agents: agentsFor(run) };
			}
		})
		.filter((item) => isDisplayActiveRun(item.run, item.agents));
}

/**
 * Build a status summary string for the status bar.
 */
export function statusSummary(runs: WidgetRun[]): string {
	const agents = runs.flatMap((item) => item.agents);
	const runningAgents = agents.filter((a) => a.status === "running").length;
	const queuedAgents = agents.filter((a) => a.status === "queued" || a.status === "waiting").length;
	const completedAgents = agents.filter((a) => a.status === "completed").length;
	const totalAgents = agents.length;
	const totalRuns = runs.length;
	const model = agents.find((a) => a.model)?.model?.split("/").at(-1);
	const parts = [`⚙ ${runningAgents}r`];
	if (queuedAgents > 0) parts.push(`${queuedAgents}q`);
	if (completedAgents > 0) parts.push(`${completedAgents}/${totalAgents}done`);
	if (totalRuns > 1) parts.push(`${totalRuns}runs`);
	if (model) parts.push(model);
	return parts.join(" · ");
}

/**
 * Build the short run label (team/workflow).
 */
export function shortRunLabel(run: TeamRunManifest): string {
	return `${run.team}/${run.workflow ?? "none"}`;
}
