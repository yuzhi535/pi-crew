#!/usr/bin/env -S npx tsx
/**
 * End-to-end test for issue #29: "Hardcoded .crew/state/runs path crashes pi
 * (uncaughtException) in .pi-based projects".
 *
 * This script reproduces the EXACT scenario from the issue:
 *  1. Create a .pi/-only project (no .crew/ directory).
 *  2. Set up an uncaughtException + unhandledRejection detector.
 *  3. Trigger the bug path: start a subagent whose runner throws, then
 *     NOT await record.promise (mimics the indirect caller pattern
 *     described in the issue).
 *  4. Exit 0 if no crash, exit 1 if crash detected.
 *
 * Run with: npx tsx scripts/test-issue-29-e2e.ts
 *
 * The script must be run via `tsx` so that the dynamic ESM import of
 * subagent-manager resolves correctly.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// ── Step 1: Set up a .pi/-only project (no .crew/) ──────────────────────
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-issue-29-e2e-"));
fs.mkdirSync(path.join(tmpDir, ".pi"), { recursive: true });
// CRITICALLY: no .crew/ directory
const projectRoot = tmpDir;

console.log("=".repeat(72));
console.log("Issue #29 end-to-end reproduction test");
console.log("=".repeat(72));
console.log(`Project root: ${projectRoot}`);
console.log(`Has .pi/:  ${fs.existsSync(path.join(projectRoot, ".pi"))}`);
console.log(
	`Has .crew/: ${fs.existsSync(path.join(projectRoot, ".crew"))} (should be false)`,
);
console.log();

// ── Step 2: Install crash detectors ──────────────────────────────────────
let crashed = false;
let crashError: Error | undefined;

process.on("uncaughtException", (error) => {
	crashed = true;
	crashError = error;
	console.error("✗ FATAL: uncaughtException fired");
	console.error("  This is the bug described in issue #29.");
	console.error(`  Error: ${error.message}`);
	if (error.stack)
		console.error(
			`  Stack: ${error.stack.split("\n").slice(0, 8).join("\n")}`,
		);
});

process.on("unhandledRejection", (reason) => {
	crashed = true;
	const reasonErr =
		reason instanceof Error ? reason : new Error(String(reason));
	crashError = reasonErr;
	console.error("✗ FATAL: unhandledRejection fired");
	console.error("  This is the bug described in issue #29.");
	console.error(`  Reason: ${reasonErr.message}`);
	if (reasonErr.stack)
		console.error(
			`  Stack: ${reasonErr.stack.split("\n").slice(0, 8).join("\n")}`,
		);
});

// ── Step 3: Trigger the bug path ─────────────────────────────────────────

async function main(): Promise<void> {
	const piCrewRoot = path.resolve(
		path.dirname(fileURLToPath(import.meta.url)),
		"..",
	);

	// Dynamic import so the .ts files are loaded through tsx, not require.
	const { SubagentManager } = await import(
		path.join(piCrewRoot, "src/runtime/subagent-manager.ts")
	);
	const { waitForRun } = await import(
		path.join(piCrewRoot, "src/runtime/run-tracker.ts")
	);
	const { projectCrewRoot } = await import(
		path.join(piCrewRoot, "src/utils/paths.ts")
	);

	// Verify the resolver returns the .pi/teams/ path for our project.
	const resolvedRoot = projectCrewRoot(projectRoot);
	console.log(`projectCrewRoot(projectRoot) = ${resolvedRoot}`);
	const expectedRoot = path.join(projectRoot, ".pi", "teams");
	if (resolvedRoot !== expectedRoot) {
		console.error(
			`✗ projectCrewRoot returned ${resolvedRoot}, expected ${expectedRoot}`,
		);
		process.exit(1);
	}
	console.log("✓ projectCrewRoot correctly resolves to .pi/teams/");
	console.log();

	// ── Test 3a: Direct waitForRun() crash path ─────────────────────────
	console.log("Test 3a: Direct waitForRun() with non-existent runId");
	console.log("-".repeat(72));
	const startA = Date.now();
	try {
		await waitForRun("team_e2e_never_exists_xyz", projectRoot, {
			timeoutMs: 500,
			pollIntervalMs: 50,
		});
		console.error("✗ waitForRun should have thrown");
	} catch (error) {
		const msg = (error as Error).message;
		const elapsed = Date.now() - startA;
		console.log(`✓ waitForRun threw after ${elapsed}ms (as expected)`);
		console.log(`  Message: ${msg}`);
		if (msg.includes(".pi/teams")) {
			console.log(
				"✓ Error message references .pi/teams/ (resolver applied)",
			);
		} else if (msg.includes(".crew/state/runs")) {
			console.error(
				`✗ Error message still references .crew/state/runs/ (BUG NOT FIXED)`,
			);
			process.exit(1);
		} else {
			console.error(
				`✗ Error message doesn't reference expected path: ${msg}`,
			);
			process.exit(1);
		}
	}
	console.log();

	// ── Test 3b: Indirect crash path via SubagentManager ────────────────
	// This is the ACTUAL crash path: subagent fails → record.promise rejects
	// → no caller awaits → unhandled rejection → pi crashes.
	console.log(
		"Test 3b: SubagentManager with runner that throws (no awaiter)",
	);
	console.log("-".repeat(72));
	const mgr = new SubagentManager();

	const runnerThatThrows = async (): Promise<never> => {
		// Simulate a failed run lookup inside the subagent — this is what
		// waitForRun() throws when the run directory doesn't exist.
		// The runner returns a synthetic result, and then pollRunToTerminal
		// would call waitForRun internally, but to keep the test focused we
		// throw directly from the runner (mimics any unhandled subagent failure).
		throw new Error(
			`Run team_e2e_simulated not found. No run directory at ${path.join(projectRoot, ".crew", "state", "runs", "team_e2e_simulated")}`,
		);
	};

	const record = mgr.spawn(
		{
			cwd: projectRoot,
			type: "test",
			description: "issue-29-e2e test",
			prompt: "simulate failure",
			background: false,
		},
		runnerThatThrows as Parameters<typeof mgr.spawn>[1],
	);

	console.log(`Spawned subagent ${record.id} (status: ${record.status})`);

	// CRITICALLY: do NOT await record.promise — this is the scenario
	// described in the issue where the throw escapes as an unhandled
	// rejection because no caller awaits.
	console.log("Waiting 500ms without awaiting record.promise...");
	await new Promise((resolve) => setTimeout(resolve, 500));

	console.log(`After 500ms:`);
	console.log(`  record.status = ${record.status}`);
	console.log(`  process.crashed = ${crashed}`);
	console.log();

	// ── Step 4: Final verdict ───────────────────────────────────────────
	if (crashed) {
		console.error("=".repeat(72));
		console.error(
			"✗ TEST FAILED: process crashed (uncaughtException or unhandledRejection)",
		);
		console.error("=".repeat(72));
		console.error("The fix in commit a80fe6c did NOT prevent the crash.");
		process.exit(1);
	}

	if (record.status !== "error") {
		console.error(
			`✗ TEST FAILED: record.status should be 'error', got '${record.status}'`,
		);
		process.exit(1);
	}

	console.log("=".repeat(72));
	console.log("✓ ALL TESTS PASSED");
	console.log("  - projectCrewRoot correctly resolves .pi/teams/");
	console.log("  - waitForRun() throws with .pi/teams/ in error message");
	console.log(
		"  - SubagentManager rejection is caught by defense-in-depth .catch",
	);
	console.log("  - No uncaughtException or unhandledRejection fired");
	console.log("=".repeat(72));

	// Cleanup
	fs.rmSync(tmpDir, { recursive: true, force: true });
	process.exit(0);
}

main().catch((error) => {
	console.error("Test script itself crashed:");
	console.error(error);
	process.exit(1);
});
