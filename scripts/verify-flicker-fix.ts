// E2E verification for the UI flicker fix.
// Loads the fixed snapshot-cache, builds a real snapshot against a temp
// run directory, fires a burst of run:state + worker:lifecycle events
// (the exact trigger the fix handles), and verifies the cache entry
// survives the burst synchronously. Pre-fix: every event deleted the
// cache entry → widget alternated between snapshot path and disk-read
// fallback every render tick. Post-fix: the entry is preserved (or
// replaced via coalesced refresh) so the widget sees a stable snapshot.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRunSnapshotCache } from "../src/ui/run-snapshot-cache.ts";
import { runEventBus } from "../src/ui/run-event-bus.ts";
import {
	createRunManifest,
	saveRunManifest,
} from "../src/state/state-store.ts";
import { saveCrewAgents } from "../src/runtime/crew-agent-records.ts";

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "verify-flicker-"));
fs.mkdirSync(path.join(cwd, ".crew"), { recursive: true });

const team = {
	name: "verify",
	description: "",
	roles: [{ name: "explorer", agent: "explorer" }],
	source: "test",
	filePath: "builtin",
};
const workflow = {
	name: "verify",
	description: "",
	steps: [{ id: "explore", role: "explorer" }],
	source: "test",
	filePath: "builtin",
};
const created = createRunManifest({ cwd, team, workflow, goal: "verify-flicker-fix" });
saveRunManifest({ ...created.manifest, status: "running" });
saveCrewAgents(created.manifest, [{
	id: `${created.manifest.runId}:01`,
	runId: created.manifest.runId,
	taskId: created.tasks[0]?.id ?? "explore",
	agent: "explorer",
	role: "explorer",
	runtime: "child-process",
	status: "running",
	startedAt: created.manifest.createdAt,
	progress: { recentTools: [], recentOutput: ["first"], toolCount: 1, currentTool: "read", tokens: 10 },
}]);

const cache = createRunSnapshotCache(cwd, { ttlMs: 60_000 });
const initial = cache.refresh(created.manifest.runId);
console.log(`INITIAL: signature=${initial.signature} tasks=${initial.tasks.length}`);

const runId = created.manifest.runId;
// Burst simulating the exact event sequence that fired the OLD flicker:
// every run:state and worker:lifecycle event in this list would have
// deleted the cache entry pre-fix.
const burst: { type: string; channel: "run:state" | "worker:lifecycle"; taskId?: string }[] = [
	{ type: "run.started", channel: "worker:lifecycle" },
	{ type: "task.started", channel: "worker:lifecycle" },
	{ type: "manifest.saved", channel: "run:state" },
	{ type: "task.claimed", channel: "run:state" },
	{ type: "manifest.saved", channel: "run:state" },
	{ type: "task.unclaimed", channel: "run:state" },
	{ type: "manifest.saved", channel: "run:state" },
	{ type: "task.claimed", channel: "run:state" },
	{ type: "worker.status", channel: "worker:lifecycle", taskId: "t1" },
	{ type: "worker.status", channel: "worker:lifecycle", taskId: "t1" },
	{ type: "task.completed", channel: "worker:lifecycle" },
	{ type: "manifest.saved", channel: "run:state" },
];
let survivalCount = 0;
for (const e of burst) {
	runEventBus.emit({ ...e, runId });
	const after = cache.get(runId);
	if (after) survivalCount++;
	else console.log(`FAILED at ${e.type} — cache entry deleted`);
}
console.log(`SURVIVED: ${survivalCount}/${burst.length} burst events`);

await new Promise((r) => setTimeout(r, 200));
const after = cache.get(runId);
console.log(`AFTER COALESCE: ${after ? `present (signature=${after.signature})` : "MISSING"}`);

fs.rmSync(cwd, { recursive: true, force: true });
console.log("\n=== RESULT ===");
if (survivalCount === burst.length && after) {
	console.log("PASS — cache survives all burst events (no flicker window)");
	process.exit(0);
} else {
	console.log("FAIL — cache was deleted by burst events");
	process.exit(1);
}
