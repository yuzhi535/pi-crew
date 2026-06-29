// test/unit/preflight-validator.test.ts
//
// ADVISORY-ONLY validator — never blocks. Tests verify the level/message/suggestion
// contract; callers (handleRun, executeTeamRun defense-in-depth) decide what to do
// with the result. The agent (caller) is always in charge.

import assert from "node:assert/strict";
import test from "node:test";
import { validateWorkflowUsage } from "../../src/workflows/preflight-validator.ts";
import type { WorkflowConfig } from "../../src/workflows/workflow-config.ts";

const baseConfig = (steps: WorkflowConfig["steps"]): WorkflowConfig => ({
	name: "test",
	description: "test",
	source: "builtin",
	filePath: "test.workflow.md",
	steps,
});

test("SINGLE → level:'warn' with raw-Agent advisory (advisory-only, never blocks)", () => {
	const wf = baseConfig([{ id: "only", role: "executor", task: "do" }]);
	const r = validateWorkflowUsage(wf);
	assert.equal(r.level, "warn");
	assert.equal(r.topology, "single");
	assert.equal(r.stepCount, 1);
	assert.match(r.message, /Single-task workflow/);
	assert.match(r.message, /Proceeding anyway/);
	assert.match(r.suggestion, /Agent tool/);
});

test("SEQUENTIAL stepCount=3 → level:'warn' with 5.7× message (advisory-only)", () => {
	const wf = baseConfig([
		{ id: "a", role: "explorer", task: "a" },
		{ id: "b", role: "executor", task: "b", dependsOn: ["a"] },
		{ id: "c", role: "verifier", task: "c", dependsOn: ["b"] },
	]);
	const r = validateWorkflowUsage(wf);
	assert.equal(r.level, "warn");
	assert.equal(r.topology, "sequential");
	assert.equal(r.stepCount, 3);
	assert.match(r.message, /5\.7× slower/);
	assert.match(r.message, /Proceeding anyway/);
	assert.match(r.suggestion, /raw Agent/);
});

test("force:true acknowledged → level:'info' (caller override intent)", () => {
	const wf = baseConfig([{ id: "only", role: "executor", task: "do" }]);
	const r = validateWorkflowUsage(wf, { force: true });
	assert.equal(r.level, "info");
	assert.equal(r.topology, "single");
	assert.match(r.message, /Force-bypassed/);
	assert.match(r.message, /acknowledged/);
});

test("CONCURRENT fanOut=4 → level:'note' (validated use case)", () => {
	const wf = baseConfig([
		{ id: "root", role: "explorer", task: "root" },
		{
			id: "a",
			role: "explorer",
			task: "a",
			parallelGroup: "g",
			dependsOn: ["root"],
		},
		{
			id: "b",
			role: "explorer",
			task: "b",
			parallelGroup: "g",
			dependsOn: ["root"],
		},
		{
			id: "c",
			role: "explorer",
			task: "c",
			parallelGroup: "g",
			dependsOn: ["root"],
		},
		{
			id: "d",
			role: "explorer",
			task: "d",
			parallelGroup: "g",
			dependsOn: ["root"],
		},
		{
			id: "join",
			role: "writer",
			task: "join",
			dependsOn: ["a", "b", "c", "d"],
		},
	]);
	const r = validateWorkflowUsage(wf);
	assert.equal(r.level, "note");
	assert.equal(r.topology, "concurrent");
	assert.equal(r.stepCount, 6);
	assert.match(r.message, /Validated use case/);
});

test("COMPLEX_DAG → level:'note' (validated use case)", () => {
	const wf = baseConfig([
		{ id: "s1", role: "explorer", task: "s1" },
		{ id: "s2", role: "explorer", task: "s2" },
		{ id: "s3", role: "executor", task: "s3", dependsOn: ["s1", "s2"] },
		{ id: "s4", role: "executor", task: "s4", dependsOn: ["s1", "s2"] },
		{ id: "s5", role: "verifier", task: "s5", dependsOn: ["s3", "s4"] },
	]);
	const r = validateWorkflowUsage(wf);
	assert.equal(r.level, "note");
	assert.equal(r.topology, "complex-dag");
	assert.equal(r.stepCount, 5);
	assert.match(r.message, /Validated use case/);
});

test("DYNAMIC (chain) → level:'info' regardless of options (runtime decides)", () => {
	const wf: WorkflowConfig = {
		name: "chain",
		description: "chain",
		source: "builtin",
		filePath: "chain.workflow.md",
		runtime: "dynamic",
		dynamicScript: "./chain.dwf.ts",
		steps: [],
	};
	const r1 = validateWorkflowUsage(wf);
	assert.equal(r1.level, "info");
	assert.equal(r1.topology, "dynamic");
	const r2 = validateWorkflowUsage(wf, { force: true });
	assert.equal(r2.level, "info");
	assert.equal(r2.topology, "dynamic");
});

test("SEQUENTIAL stepCount=2 → level:'warn' (advisory)", () => {
	const wf = baseConfig([
		{ id: "a", role: "explorer", task: "a" },
		{ id: "b", role: "executor", task: "b", dependsOn: ["a"] },
	]);
	const r = validateWorkflowUsage(wf);
	assert.equal(r.level, "warn");
	assert.equal(r.topology, "sequential");
	assert.equal(r.stepCount, 2);
	assert.match(r.message, /2-step sequential/);
	assert.match(r.message, /Proceeding anyway/);
});

test("SEQUENTIAL stepCount=4 → level:'warn' with audit-trail caveat", () => {
	const wf = baseConfig([
		{ id: "a", role: "explorer", task: "a" },
		{ id: "b", role: "planner", task: "b", dependsOn: ["a"] },
		{ id: "c", role: "executor", task: "c", dependsOn: ["b"] },
		{ id: "d", role: "verifier", task: "d", dependsOn: ["c"] },
	]);
	const r = validateWorkflowUsage(wf);
	assert.equal(r.level, "warn");
	assert.equal(r.topology, "sequential");
	assert.equal(r.stepCount, 4);
	assert.match(r.message, /4-step sequential/);
});

test("warn result always includes recommendation for telemetry", () => {
	const wf = baseConfig([
		{ id: "a", role: "explorer", task: "a" },
		{ id: "b", role: "executor", task: "b", dependsOn: ["a"] },
		{ id: "c", role: "verifier", task: "c", dependsOn: ["b"] },
	]);
	const r = validateWorkflowUsage(wf);
	assert.equal(r.recommendation, "raw_agent");
});

test("note result always includes recommendation for telemetry", () => {
	const wf = baseConfig([
		{ id: "a", role: "explorer", task: "a", parallelGroup: "g" },
		{ id: "b", role: "explorer", task: "b", parallelGroup: "g" },
		{ id: "c", role: "explorer", task: "c", parallelGroup: "g" },
	]);
	const r = validateWorkflowUsage(wf);
	assert.equal(r.recommendation, "parallel_research");
});

test("validator never throws — always returns a PreflightResult", () => {
	// Even malformed inputs get a result, never an exception.
	const wf: WorkflowConfig = {
		name: "edge",
		description: "edge",
		source: "builtin",
		filePath: "edge.workflow.md",
		steps: [],
	};
	const r = validateWorkflowUsage(wf);
	assert.ok(["info", "note", "warn"].includes(r.level));
});

test("all three severity levels are reachable for known topologies", () => {
	const cases: Array<{
		name: string;
		steps: WorkflowConfig["steps"];
		expected: "info" | "note" | "warn";
	}> = [
		{ name: "info-dynamic", steps: [], expected: "info" },
		{
			name: "warn-single",
			steps: [{ id: "only", role: "executor", task: "x" }],
			expected: "warn",
		},
		{
			name: "warn-sequential-3",
			steps: [
				{ id: "a", role: "explorer", task: "a" },
				{ id: "b", role: "executor", task: "b", dependsOn: ["a"] },
				{ id: "c", role: "verifier", task: "c", dependsOn: ["b"] },
			],
			expected: "warn",
		},
		{
			name: "note-concurrent",
			steps: [
				{ id: "a", role: "explorer", task: "a", parallelGroup: "g" },
				{ id: "b", role: "explorer", task: "b", parallelGroup: "g" },
				{ id: "c", role: "explorer", task: "c", parallelGroup: "g" },
			],
			expected: "note",
		},
		{
			name: "note-complex-dag",
			steps: [
				{ id: "s1", role: "explorer", task: "s1" },
				{ id: "s2", role: "explorer", task: "s2" },
				{
					id: "s3",
					role: "executor",
					task: "s3",
					dependsOn: ["s1", "s2"],
				},
				{
					id: "s4",
					role: "verifier",
					task: "s4",
					dependsOn: ["s1", "s2"],
				},
				{
					id: "s5",
					role: "writer",
					task: "s5",
					dependsOn: ["s3", "s4"],
				},
			],
			expected: "note",
		},
	];
	for (const c of cases) {
		const wf = baseConfig(c.steps);
		if (c.name === "info-dynamic") wf.runtime = "dynamic";
		const r = validateWorkflowUsage(wf);
		assert.equal(
			r.level,
			c.expected,
			`${c.name}: expected ${c.expected}, got ${r.level}`,
		);
	}
});
