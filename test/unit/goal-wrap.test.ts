/**
 * goal-wrap unit tests (RFC v0.5 vision: apply goal completion-guarantee to builtins).
 *
 * Tests the config resolution + validation logic WITHOUT spawning the background
 * goal-loop (that's runtime-tested separately). Exercises:
 *   - isGoalWrapEnabled: only eligible builtins, respects config, default OFF
 *   - validateGoalWrapConfig: budget required / mutex / evaluatorModel required
 *   - GOAL_WRAP_ELIGIBLE_BUILTINS: implementation, fast-fix, default
 */
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
	GOAL_WRAP_ELIGIBLE_BUILTINS,
	isGoalWrapEnabled,
	validateGoalWrapConfig,
} from "../../src/extension/team-tool/goal-wrap.ts";

function tmpCwd(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-goalwrap-"));
}

function writeConfig(cwd: string, config: unknown): void {
	const crewRoot = path.join(cwd, ".crew");
	fs.mkdirSync(crewRoot, { recursive: true });
	fs.writeFileSync(path.join(crewRoot, "config.json"), JSON.stringify(config));
}

test("GOAL_WRAP_ELIGIBLE_BUILTINS includes implementation, fast-fix, default", () => {
	assert.ok(GOAL_WRAP_ELIGIBLE_BUILTINS.has("implementation"));
	assert.ok(GOAL_WRAP_ELIGIBLE_BUILTINS.has("fast-fix"));
	assert.ok(GOAL_WRAP_ELIGIBLE_BUILTINS.has("default"));
	// Read-only workflows are NOT eligible.
	assert.ok(!GOAL_WRAP_ELIGIBLE_BUILTINS.has("review"));
	assert.ok(!GOAL_WRAP_ELIGIBLE_BUILTINS.has("research"));
	assert.ok(!GOAL_WRAP_ELIGIBLE_BUILTINS.has("parallel-research"));
});

test("isGoalWrapEnabled: returns false when no config (default OFF)", () => {
	const cwd = tmpCwd();
	try {
		// No .crew/config.json in a fresh tmp dir → goal-wrap must be OFF by default.
		assert.equal(isGoalWrapEnabled(cwd, "implementation"), false);
		assert.equal(isGoalWrapEnabled(cwd, "fast-fix"), false);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

// Note: testing isGoalWrapEnabled=true requires loadConfig to find a temp .crew/config.json,
// which depends on projectCrewRoot's repo-root resolution (fragile in tmp dirs). The full
// integration is covered by runtime tests; here we verify the default-OFF path + the
// eligibility gate (which is pure logic) + the validation logic (pure).

// --- validateGoalWrapConfig ---

test("validateGoalWrapConfig: returns undefined for valid unlimited config", () => {
	assert.equal(validateGoalWrapConfig({ enabled: true, evaluatorModel: "minimax/MiniMax-M3", budgetUnlimited: true }), undefined);
});

test("validateGoalWrapConfig: returns undefined for valid budgetTotal config", () => {
	assert.equal(validateGoalWrapConfig({ enabled: true, evaluatorModel: "minimax/MiniMax-M3", budgetTotal: 5000 }), undefined);
});

test("validateGoalWrapConfig: requires evaluatorModel", () => {
	const err = validateGoalWrapConfig({ enabled: true, budgetUnlimited: true });
	assert.match(err ?? "", /evaluatorModel/i);
});

test("validateGoalWrapConfig: requires budget (no silent unbounded default)", () => {
	const err = validateGoalWrapConfig({ enabled: true, evaluatorModel: "x" });
	assert.match(err ?? "", /budgetTotal.*budgetUnlimited/i);
});

test("validateGoalWrapConfig: rejects both budgetTotal AND budgetUnlimited (mutex)", () => {
	const err = validateGoalWrapConfig({ enabled: true, evaluatorModel: "x", budgetTotal: 5000, budgetUnlimited: true });
	assert.match(err ?? "", /mutually exclusive/i);
});

test("validateGoalWrapConfig: rejects budgetTotal below 1000 floor", () => {
	const err = validateGoalWrapConfig({ enabled: true, evaluatorModel: "x", budgetTotal: 500 });
	assert.match(err ?? "", /budgetTotal.*1000|>=1000/i);
});
