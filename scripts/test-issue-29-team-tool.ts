#!/usr/bin/env -S npx tsx
/**
 * Real-world reproduction of issue #29.
 *
 * Scenario (from the issue report):
 *   1. User has a .pi/-only project (no .crew/ directory).
 *   2. A background team run is in progress; the run directory does NOT
 *      exist on disk yet (the worker is still starting up).
 *   3. waitForRun() is called to wait for the run to complete.
 *   4. waitForRun() takes the slow path and on attempt 0 hits the
 *      early-exit "Run not found" check.
 *
 * On the BUGGY version (pre-fix a80fe6c):
 *   - The early-exit check uses `path.join(cwd, ".crew", "state", "runs", runId)`
 *   - That directory does not exist in a .pi/-only project
 *   - Throws "Run not found. No run directory at <cwd>/.crew/state/runs/..."
 *   - The throw escapes as an unhandled rejection → pi crashes
 *
 * On the FIXED version (a80fe6c):
 *   - The early-exit check uses `path.join(projectCrewRoot(cwd), "state", "runs", runId)`
 *   - In a .pi/-only project, projectCrewRoot returns .pi/teams/
 *   - The check still throws (the directory doesn't exist anywhere), but the
 *     error message correctly points at .pi/teams/state/runs/...
 *
 * The test is "passes on fixed, fails on buggy" — verified by toggling the
 * fix in src/runtime/run-tracker.ts.
 *
 * Run with: npx tsx scripts/test-issue-29-team-tool.ts
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-issue-29-real-"));
fs.mkdirSync(path.join(tmpDir, ".pi"), { recursive: true });
// CRITICALLY: no .crew/

console.log("Issue #29 REAL-WORLD reproduction test");
console.log(`Project: ${tmpDir}`);
console.log(`  Has .pi/:  ${fs.existsSync(path.join(tmpDir, ".pi"))}`);
console.log(
	`  Has .crew/: ${fs.existsSync(path.join(tmpDir, ".crew"))} (should be false)`,
);
console.log();

async function main(): Promise<void> {
	const piCrewRoot = path.resolve(
		path.dirname(fileURLToPath(import.meta.url)),
		"..",
	);

	// Realistic scenario: the run manifest does NOT exist yet (the background
	// worker is still starting up). waitForRun() takes the slow path and
	// hits the early-exit check on attempt 0 — that's where the bug fires.
	const runId = `team_real_${Date.now().toString(36)}`;
	console.log(`Looking for run ${runId}`);
	console.log(
		`  Expected (correct) path: ${path.join(tmpDir, ".pi", "teams", "state", "runs", runId)}`,
	);
	console.log(
		`  Buggy path:              ${path.join(tmpDir, ".crew", "state", "runs", runId)}`,
	);
	console.log();

	const { waitForRun } = await import(
		path.join(piCrewRoot, "src/runtime/run-tracker.ts")
	);

	console.log("Calling waitForRun()...");
	const start = Date.now();
	try {
		const result = await waitForRun(runId, tmpDir, {
			timeoutMs: 500,
			pollIntervalMs: 100,
		});
		const elapsed = Date.now() - start;
		console.error(
			`✗ waitForRun unexpectedly SUCCEEDED in ${elapsed}ms (should have thrown)`,
		);
		console.error(`  manifest.status = ${result.manifest.status}`);
		process.exit(1);
	} catch (error) {
		const elapsed = Date.now() - start;
		const msg = (error as Error).message;
		console.log(`waitForRun threw after ${elapsed}ms:`);
		console.log(`  Message: ${msg}`);
		console.log();

		// The error message must reference the CORRECT path (.pi/teams/...),
		// not the old hardcoded .crew/state/runs/...
		if (msg.includes(".pi/teams")) {
			console.log(
				"✓ Error message references .pi/teams/ (resolver applied)",
			);
			console.log(
				"✓ TEST PASSED: waitForRun correctly resolves .pi/teams/state/runs/",
			);
			fs.rmSync(tmpDir, { recursive: true, force: true });
			process.exit(0);
		}
		if (msg.includes(".crew/state/runs")) {
			console.error(
				"✗ TEST FAILED: Error message references .crew/state/runs/",
			);
			console.error("  This is the bug described in issue #29:");
			console.error(
				"  waitForRun() looked in .crew/state/runs/ instead of .pi/teams/state/runs/",
			);
			fs.rmSync(tmpDir, { recursive: true, force: true });
			process.exit(1);
		}
		console.error(
			`✗ TEST FAILED: Error message doesn't reference expected path`,
		);
		console.error(`  Got: ${msg}`);
		fs.rmSync(tmpDir, { recursive: true, force: true });
		process.exit(1);
	}
}

main().catch((error) => {
	console.error("Test script itself crashed:");
	console.error(error);
	fs.rmSync(tmpDir, { recursive: true, force: true });
	process.exit(1);
});
