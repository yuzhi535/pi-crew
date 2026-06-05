#!/usr/bin/env -S npx tsx
/**
 * REAL-RUNTIME E2E test for issue #29.
 *
 * This is the most realistic test possible without invoking the full
 * `pi` agent loop. It:
 *   1. Sets up a .pi/-only project (no .crew/).
 *   2. Creates a real team run manifest via createRunManifest().
 *   3. Calls spawnBackgroundTeamRun() which spawns a REAL detached
 *      background-runner.ts process (the same path used by `team action='run'`).
 *   4. Waits for the background runner to write background.log and exit.
 *   5. Verifies EVERY path the fix touched:
 *      - logPath is at .pi/teams/state/runs/<runId>/background.log
 *      - exit-code.txt is at .pi/teams/state/runs/<runId>/exit-code.txt
 *      - manifest.json is at .pi/teams/state/runs/<runId>/manifest.json
 *      - tasks.json is at .pi/teams/state/runs/<runId>/tasks.json
 *      - events.jsonl is at .pi/teams/state/runs/<runId>/events.jsonl
 *   6. Verifies NO files leak to .crew/state/runs/...
 *   7. Captures any uncaughtException/unhandledRejection from the test
 *      process (which would indicate the bug fires).
 *
 * The test uses PI_CREW_EXECUTE_WORKERS=false so the team-runner uses
 * "scaffold" runtime (no child Pi agents spawned), but the background-
 * runner process itself is REAL — it actually runs, writes to disk, and
 * exits. This exercises all 11 fixed sites:
 *   - background-runner.ts:139 (log redirect path)
 *   - background-runner.ts:172 (exit-code path)
 *   - run-tracker.ts:82 (waitForRun slow path early-exit)
 *   - checkpoint.ts:166,177,188,199,209 (5 sites)
 *   - skill-effectiveness.ts:115,125 (when tasks complete)
 *   - decision-ledger.ts:29 (when rollouts happen)
 *
 * Run with: npx tsx scripts/test-issue-29-real-runtime.ts
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const tmpDir = fs.mkdtempSync(
	path.join(os.tmpdir(), "pi-crew-issue-29-runtime-"),
);
fs.mkdirSync(path.join(tmpDir, ".pi"), { recursive: true });
// CRITICALLY: no .crew/

console.log("=".repeat(72));
console.log("Issue #29 REAL-RUNTIME E2E test");
console.log("  (spawns REAL detached background-runner.ts process)");
console.log("=".repeat(72));
console.log(`Project: ${tmpDir}`);
console.log(`  Has .pi/  : ${fs.existsSync(path.join(tmpDir, ".pi"))}`);
console.log(
	`  Has .crew/: ${fs.existsSync(path.join(tmpDir, ".crew"))} (should be false)`,
);
console.log();

// ── Crash detection ──────────────────────────────────────────────────────
let crashed = false;
let crashError: Error | undefined;
process.on("uncaughtException", (error) => {
	crashed = true;
	crashError = error;
	console.error(`[CRASH] uncaughtException: ${error.message}`);
});
process.on("unhandledRejection", (reason) => {
	crashed = true;
	const err = reason instanceof Error ? reason : new Error(String(reason));
	crashError = err;
	console.error(`[CRASH] unhandledRejection: ${err.message}`);
});

// Force placeholder workers in the background runner (no LLM needed).
// The runtime resolver checks for "0" (string) to disable child worker execution.
process.env.PI_CREW_EXECUTE_WORKERS = "0";
process.env.PI_TEAMS_EXECUTE_WORKERS = "0";
// We also need to set runConfig.runtime.mode = "scaffold" in the manifest
// because the background-runner explicitly blocks PI_CREW_EXECUTE_WORKERS
// from leaking to the child (security feature).

const piCrewRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail = ""): void {
	if (condition) {
		pass++;
		console.log(`  ✓ ${label}`);
	} else {
		fail++;
		failures.push(label);
		console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
	}
}

async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFile(
	filePath: string,
	timeoutMs: number,
): Promise<boolean> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (fs.existsSync(filePath)) return true;
		await sleep(100);
	}
	return false;
}

async function main(): Promise<void> {
	const { createRunManifest } = await import(
		path.join(piCrewRoot, "src/state/state-store.ts")
	);
	const { discoverTeams, allTeams } = await import(
		path.join(piCrewRoot, "src/teams/discover-teams.ts")
	);
	const { discoverWorkflows, allWorkflows } = await import(
		path.join(piCrewRoot, "src/workflows/discover-workflows.ts")
	);
	const { spawnBackgroundTeamRun } = await import(
		path.join(piCrewRoot, "src/runtime/async-runner.ts")
	);
	const { projectCrewRoot, clearProjectRootCache } = await import(
		path.join(piCrewRoot, "src/utils/paths.ts")
	);
	const { loadRunManifestById } = await import(
		path.join(piCrewRoot, "src/state/state-store.ts")
	);

	clearProjectRootCache();
	const root = projectCrewRoot(tmpDir);
	check(
		`projectCrewRoot returns .pi/teams/`,
		root === path.join(tmpDir, ".pi", "teams"),
	);

	// ── Set up a team run ─────────────────────────────────────────────
	console.log();
	console.log("Step 1: Create team run manifest");
	console.log("-".repeat(72));

	const teams = allTeams(discoverTeams(tmpDir));
	const workflows = allWorkflows(discoverWorkflows(tmpDir));
	const team = teams.find((t) => t.name === "fast-fix");
	const workflow = workflows.find((w) => w.name === "fast-fix");
	check("fast-fix team discovered", Boolean(team));
	check("fast-fix workflow discovered", Boolean(workflow));

	if (!team || !workflow) {
		console.error("Cannot continue without team/workflow");
		process.exit(1);
	}

	const { manifest } = createRunManifest({
		cwd: tmpDir,
		team,
		workflow,
		goal: "REAL RUNTIME test: spawn background runner, verify paths land in .pi/teams/state/runs/",
		workspaceMode: "single",
	});

	// Force scaffold mode so no child Pi workers are spawned (no LLM needed).
	// This is what the background-runner will use.
	const scaffoldRuntimeResolution = {
		kind: "scaffold" as const,
		requestedMode: "scaffold" as const,
		available: true,
		reason: "Test: forced scaffold mode for E2E without LLM",
		resolvedAt: new Date().toISOString(),
	};
	const scaffoldRunConfig = {
		...((manifest as { runConfig?: unknown }).runConfig ?? {}),
		executeWorkers: false,
		runtime: {
			...(((manifest as { runConfig?: { runtime?: unknown } }).runConfig
				?.runtime ?? {}) as Record<string, unknown>),
			mode: "scaffold",
		},
	};
	const manifestWithRuntime = {
		...manifest,
		runtimeResolution: scaffoldRuntimeResolution,
		runConfig: scaffoldRunConfig,
	};

	// Override status to queued (createRunManifest sets it, but let's be explicit)
	const queuedManifest = {
		...manifestWithRuntime,
		status: "queued" as const,
	};
	console.log(`  Created run: ${queuedManifest.runId}`);
	console.log(`  stateRoot:   ${queuedManifest.stateRoot}`);
	console.log(
		`  runtime:     ${queuedManifest.runtimeResolution?.kind ?? "(default)"}`,
	);

	check(
		`manifest.stateRoot is under .pi/teams/state/runs/`,
		queuedManifest.stateRoot ===
			path.join(
				tmpDir,
				".pi",
				"teams",
				"state",
				"runs",
				queuedManifest.runId,
			),
		`got: ${queuedManifest.stateRoot}`,
	);

	// ── Step 2: Spawn REAL background runner ──────────────────────────
	console.log();
	console.log(
		"Step 2: spawnBackgroundTeamRun() — spawn REAL detached process",
	);
	console.log("-".repeat(72));

	// Pass the queued manifest (background runner expects this format)
	// We also need to write the manifest to disk so the runner can read it.
	const stateDir = queuedManifest.stateRoot;
	fs.mkdirSync(stateDir, { recursive: true });
	fs.writeFileSync(
		path.join(stateDir, "manifest.json"),
		JSON.stringify(queuedManifest, null, 2),
	);

	const tStart = Date.now();
	const spawnResult = await spawnBackgroundTeamRun(queuedManifest);
	console.log(`  Spawned background runner`);
	console.log(`    PID:     ${spawnResult.pid ?? "(unknown)"}`);
	console.log(`    logPath: ${spawnResult.logPath}`);
	console.log();

	// ── Step 3: Verify the logPath is in the CORRECT location ─────────
	// This is the path the background-runner.ts writes to (line 139).
	check(
		`logPath is under .pi/teams/state/runs/<runId>/background.log`,
		spawnResult.logPath === path.join(stateDir, "background.log"),
		`got: ${spawnResult.logPath}`,
	);
	check(
		`logPath is NOT under .crew/state/runs/...`,
		!spawnResult.logPath.includes(".crew/state/runs"),
	);

	// ── Step 4: Wait for the background runner to finish ──────────────
	console.log();
	console.log("Step 3: Wait for background runner to write logs and exit");
	console.log("-".repeat(72));

	// Wait for background.log to exist
	const logWritten = await waitForFile(spawnResult.logPath, 30_000);
	if (!logWritten) {
		fail++;
		failures.push("background.log was created within 30s");
		console.error("  ✗ background.log was not created within 30s");
	} else {
		console.log(`  ✓ background.log created at ${spawnResult.logPath}`);
	}

	// Wait for exit-code.txt (background-runner.ts:172 writes this on exit)
	const exitCodePath = path.join(stateDir, "exit-code.txt");
	const exitCodeWritten = await waitForFile(exitCodePath, 30_000);
	if (!exitCodeWritten) {
		fail++;
		failures.push("exit-code.txt was created within 30s");
		console.error("  ✗ exit-code.txt was not created within 30s");
	} else {
		const elapsed = Date.now() - tStart;
		console.log(`  ✓ exit-code.txt created in ${elapsed}ms`);
		const exitCode = fs.readFileSync(exitCodePath, "utf-8").trim();
		console.log(`    Contents: ${JSON.stringify(exitCode.slice(0, 200))}`);
	}

	// Wait for the process to actually exit
	let processExited = false;
	for (let i = 0; i < 50; i++) {
		if (spawnResult.pid !== undefined) {
			try {
				process.kill(spawnResult.pid, 0); // Check if alive
				await sleep(200);
			} catch {
				processExited = true;
				break;
			}
		} else {
			// No PID — assume the runner already exited (synchronously)
			processExited = true;
			break;
		}
	}
	check(
		`background runner process exited (PID ${spawnResult.pid})`,
		processExited,
	);

	// ── Step 5: Verify NO files leaked to .crew/ ──────────────────────
	console.log();
	console.log("Step 4: Verify no .crew/ files were created");
	console.log("-".repeat(72));

	const crewDir = path.join(tmpDir, ".crew");
	check(
		`no .crew/ directory was created (would indicate fallback)`,
		!fs.existsSync(crewDir),
		`found at: ${crewDir}`,
	);

	// Also check that all the expected files are under .pi/teams/
	const expectedFiles = [
		"manifest.json",
		"tasks.json",
		"events.jsonl",
		"background.log",
		"exit-code.txt",
	];
	for (const f of expectedFiles) {
		const p = path.join(stateDir, f);
		check(
			`${f} exists at .pi/teams/state/runs/<runId>/${f}`,
			fs.existsSync(p),
		);
	}

	// ── Step 6: Verify the runner wrote meaningful content ───────────
	console.log();
	console.log("Step 5: Verify background runner output");
	console.log("-".repeat(72));

	if (logWritten) {
		const logContent = fs.readFileSync(spawnResult.logPath, "utf-8");
		const lineCount = logContent.split("\n").filter((l) => l.trim()).length;
		check(
			`background.log has content (${lineCount} non-empty lines)`,
			lineCount > 0,
		);
		console.log(
			`    First 200 chars: ${JSON.stringify(logContent.slice(0, 200))}`,
		);
	}

	// Verify the manifest was updated by the runner
	const reloaded = loadRunManifestById(tmpDir, queuedManifest.runId);
	check(`manifest can be reloaded after runner completed`, Boolean(reloaded));
	if (reloaded) {
		console.log(`    Final status: ${reloaded.manifest.status}`);
		check(
			`final status is completed/failed/cancelled (not 'running')`,
			["completed", "failed", "cancelled"].includes(
				reloaded.manifest.status,
			),
			`got: ${reloaded.manifest.status}`,
		);
	}

	// ── Final verdict ───────────────────────────────────────────────────
	console.log();
	console.log("=".repeat(72));
	console.log(
		`Results: ${pass} passed, ${fail} failed, ${crashed ? "1" : "0"} crashed`,
	);
	if (failures.length > 0) {
		console.error("Failures:");
		for (const f of failures) console.error(`  - ${f}`);
	}
	if (crashed) {
		console.error(`Crashed: ${crashError?.message}`);
	}
	console.log("=".repeat(72));

	// Cleanup
	try {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		/* ignore */
	}

	if (crashed || fail > 0) {
		process.exit(1);
	}
	process.exit(0);
}

main().catch((error) => {
	console.error("Test script itself crashed:");
	console.error(error);
	try {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		/* ignore */
	}
	process.exit(1);
});
