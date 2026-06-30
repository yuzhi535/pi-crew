import test from "node:test";
import assert from "node:assert/strict";
import {
	runPhaseGates,
	computeGreenLevelFromResults,
	executeVerificationCommands,
	NPM_TYPESCRIPT_GATES,
	CARGO_RUST_GATES,
} from "../../src/runtime/verification-gates.ts";
import type { VerificationCommandResult } from "../../src/state/types.ts";
import { pickCmd, OK_CMD, FAIL_CMD, ECHO_CMD } from "../fixtures/cross-platform-cmd.ts";

test("verification-gates: NPM_TYPESCRIPT_GATES has expected phases", () => {
	assert.equal(NPM_TYPESCRIPT_GATES.length, 4);
	assert.ok(NPM_TYPESCRIPT_GATES.every((g) => g.name && g.command));
});

test("verification-gates: CARGO_RUST_GATES has expected phases", () => {
	assert.equal(CARGO_RUST_GATES.length, 3);
	assert.ok(CARGO_RUST_GATES.every((g) => g.name && g.command));
});

test("verification-gates: runPhaseGates executes commands sequentially", async () => {
	// Simple test: echo command that always succeeds.
	// Use cross-platform helper: `echo 'X'` on POSIX, `node -e "process.stdout.write('X\n')"` on win32.
	const gates = [
		{ name: "echo", command: pickCmd(ECHO_CMD("hello")), critical: true },
		{ name: "echo2", command: pickCmd(ECHO_CMD("world")), critical: true },
	];
	const result = await runPhaseGates(gates, process.cwd());
	assert.equal(result.results.length, 2);
	assert.equal(result.results[0].status, "passed");
	assert.equal(result.results[1].status, "passed");
	assert.ok(result.allPassed);
});

test("verification-gates: runPhaseGates stops on critical failure", async () => {
	const gates = [
		{ name: "success", command: pickCmd(OK_CMD), critical: true },
		{ name: "fails", command: pickCmd(FAIL_CMD), critical: true },
		{ name: "would-run", command: pickCmd(ECHO_CMD("should not run")), critical: true },
	];
	const result = await runPhaseGates(gates, process.cwd());
	// Results contain only executed gates (not skipped)
	assert.equal(result.results.length, 2);
	assert.equal(result.results[0].status, "passed");
	assert.equal(result.results[1].status, "failed");
	assert.ok(!result.allPassed);
	assert.equal(result.stoppedAt, 2);
});

test("verification-gates: runPhaseGates continues on non-critical failure", async () => {
	const gates = [
		{ name: "success", command: pickCmd(OK_CMD), critical: true },
		{ name: "fails", command: pickCmd(FAIL_CMD), critical: false },
		{ name: "continues", command: pickCmd(ECHO_CMD("still going")), critical: true },
	];
	const result = await runPhaseGates(gates, process.cwd());
	assert.equal(result.results.length, 3);
	assert.equal(result.results[0].status, "passed");
	assert.equal(result.results[1].status, "failed");
	assert.equal(result.results[2].status, "passed");
});

test("verification-gates: computeGreenLevelFromResults all passed", () => {
	const results: VerificationCommandResult[] = [
		{ cmd: "npm test", status: "passed", exitCode: 0 },
		{ cmd: "npm run build", status: "passed", exitCode: 0 },
	];
	const level = computeGreenLevelFromResults(results, "targeted");
	assert.equal(level, "targeted");
});

test("verification-gates: computeGreenLevelFromResults all failed", () => {
	const results: VerificationCommandResult[] = [
		{ cmd: "npm test", status: "failed", exitCode: 1 },
	];
	const level = computeGreenLevelFromResults(results, "targeted");
	assert.equal(level, "none");
});

test("verification-gates: computeGreenLevelFromResults partial pass", () => {
	const results: VerificationCommandResult[] = [
		{ cmd: "npm test", status: "passed", exitCode: 0 },
		{ cmd: "npm run build", status: "not_run" },
	];
	const level = computeGreenLevelFromResults(results, "targeted");
	assert.equal(level, "targeted");
});

test("verification-gates: computeGreenLevelFromResults empty commands", () => {
	const results: VerificationCommandResult[] = [];
	const level = computeGreenLevelFromResults(results, "targeted");
	assert.equal(level, "none");
});

test("verification-gates: executeVerificationCommands with empty contract", async () => {
	const results = await executeVerificationCommands(
		{ requiredGreenLevel: "targeted", commands: [], allowManualEvidence: true },
		process.cwd(),
		"test-run",
		"test-task",
		"/tmp",
	);
	assert.deepEqual(results, []);
});
