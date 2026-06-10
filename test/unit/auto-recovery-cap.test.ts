import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

/**
 * Round 22 (defensive caps): `autoRecoveryLast` is a module-level Map inside
 * `register.ts:484` that holds cooldown timestamps for "recovery notifications"
 * (5-minute gate per key). Without a cap, a long-running pi session that runs
 * thousands of teams accumulates thousands of entries.
 *
 * The cap is enforced inside an internal closure in the `register()` function
 * — there's no exported handle to invoke directly. We test the cap behavior
 * by:
 *   1. Static check: the source file MUST contain the cap constant
 *      (`AUTO_RECOVERY_LAST_MAX_ENTRIES`) and an eviction loop.
 *   2. The pattern matches the existing `NotificationRouter.SEEN_MAP_MAX_SIZE`
 *      eviction strategy in the same codebase (oldest-insertion-first).
 */
test("register.ts implements an autoRecoveryLast defensive cap (Round 22)", () => {
	const here = path.dirname(fileURLToPath(import.meta.url));
	const registerPath = path.resolve(here, "..", "..", "src", "extension", "register.ts");
	const source = fs.readFileSync(registerPath, "utf-8");

	assert.match(
		source,
		/AUTO_RECOVERY_LAST_MAX_ENTRIES\s*=\s*\d+/,
		"register.ts should declare AUTO_RECOVERY_LAST_MAX_ENTRIES cap constant",
	);
	assert.match(
		source,
		/while\s*\(\s*autoRecoveryLast\.size\s*>=\s*AUTO_RECOVERY_LAST_MAX_ENTRIES\s*\)/,
		"register.ts should evict oldest entries when the cap is reached",
	);
	assert.match(
		source,
		/lastAccessAt.*oldest/,
		"register.ts should use LRU-style eviction (based on lastAccessAt) for autoRecoveryLast cap",
	);
});

test("crew-agent-records.ts implements an agentEventSeqCache defensive cap (Round 22)", () => {
	const here = path.dirname(fileURLToPath(import.meta.url));
	const recordsPath = path.resolve(here, "..", "..", "src", "runtime", "crew-agent-records.ts");
	const source = fs.readFileSync(recordsPath, "utf-8");

	assert.match(
		source,
		/AGENT_EVENT_SEQ_CACHE_MAX_ENTRIES\s*=\s*\d+/,
		"crew-agent-records.ts should declare AGENT_EVENT_SEQ_CACHE_MAX_ENTRIES cap constant",
	);
	assert.match(
		source,
		/while\s*\(\s*agentEventSeqCache\.size\s*>\s*AGENT_EVENT_SEQ_CACHE_MAX_ENTRIES\s*\)/,
		"crew-agent-records.ts should evict oldest entries when the cap is reached",
	);
	assert.match(
		source,
		/agentEventSeqCache\.keys\(\)\.next\(\)\.value/,
		"crew-agent-records.ts should use Map's natural insertion order (oldest first) for eviction",
	);
});
