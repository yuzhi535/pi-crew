// test/unit/topology-analyzer.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import {
	analyzeWorkflowTopology,
	dagDepthFromSteps,
	fanOutDegreeFromSteps,
	parallelGroupsFromSteps,
} from "../../src/workflows/topology-analyzer.ts";
import type { WorkflowConfig } from "../../src/workflows/workflow-config.ts";

const baseConfig = (steps: WorkflowConfig["steps"]): WorkflowConfig => ({
	name: "test",
	description: "test",
	source: "builtin",
	filePath: "test.workflow.md",
	steps,
});

test("SINGLE: 1-step workflow classifies as single, recommends raw_agent", () => {
	const wf = baseConfig([{ id: "only", role: "executor", task: "do" }]);
	const a = analyzeWorkflowTopology(wf);
	assert.equal(a.topology, "single");
	assert.equal(a.stepCount, 1);
	assert.equal(a.recommendation, "raw_agent");
	assert.equal(a.fanOutDegree, 0);
	assert.equal(a.parallelGroupCount, 0);
	assert.equal(a.dagDepth, 1);
});

test("SEQUENTIAL: default workflow shape (4 steps, linear, no parallelGroup)", () => {
	const wf = baseConfig([
		{ id: "explore", role: "explorer", task: "explore" },
		{ id: "plan", role: "planner", task: "plan", dependsOn: ["explore"] },
		{
			id: "execute",
			role: "executor",
			task: "execute",
			dependsOn: ["plan"],
		},
		{
			id: "verify",
			role: "verifier",
			task: "verify",
			dependsOn: ["execute"],
		},
	]);
	const a = analyzeWorkflowTopology(wf);
	assert.equal(a.topology, "sequential");
	assert.equal(a.stepCount, 4);
	assert.equal(a.parallelGroupCount, 0);
	assert.equal(a.fanOutDegree, 0);
	assert.equal(a.dagDepth, 4);
	assert.equal(a.recommendation, "fast_fix");
});

test("SEQUENTIAL-3: fast-fix (3 steps, linear) recommends raw_agent", () => {
	const wf = baseConfig([
		{ id: "explore", role: "explorer", task: "explore" },
		{
			id: "execute",
			role: "executor",
			task: "execute",
			dependsOn: ["explore"],
		},
		{
			id: "verify",
			role: "verifier",
			task: "verify",
			dependsOn: ["execute"],
		},
	]);
	const a = analyzeWorkflowTopology(wf);
	assert.equal(a.topology, "sequential");
	assert.equal(a.stepCount, 3);
	assert.equal(a.recommendation, "raw_agent");
	assert.equal(a.dagDepth, 3);
});

test("CONCURRENT: parallel-research shape (7 steps, 4-way fan-out)", () => {
	const wf = baseConfig([
		{ id: "discover", role: "explorer", task: "discover" },
		{
			id: "explore-core",
			role: "explorer",
			task: "core",
			parallelGroup: "explore",
		},
		{
			id: "explore-ui",
			role: "explorer",
			task: "ui",
			parallelGroup: "explore",
		},
		{
			id: "explore-runtime",
			role: "explorer",
			task: "runtime",
			parallelGroup: "explore",
		},
		{
			id: "explore-extensions",
			role: "explorer",
			task: "ext",
			parallelGroup: "explore",
		},
		{
			id: "synthesize",
			role: "analyst",
			task: "synth",
			dependsOn: [
				"explore-core",
				"explore-ui",
				"explore-runtime",
				"explore-extensions",
			],
		},
		{
			id: "write",
			role: "writer",
			task: "write",
			dependsOn: ["synthesize"],
		},
	]);
	const a = analyzeWorkflowTopology(wf);
	assert.equal(a.topology, "concurrent");
	assert.equal(a.stepCount, 7);
	assert.equal(a.parallelGroupCount, 1);
	assert.equal(a.fanOutDegree, 4);
	assert.equal(a.recommendation, "parallel_research");
	assert.equal(a.dagDepth, 3);
});

test("COMPLEX_DAG: synthetic 5-step workflow with 2 multi-dep nodes", () => {
	const wf = baseConfig([
		{ id: "s1", role: "explorer", task: "s1" },
		{ id: "s2", role: "explorer", task: "s2" },
		{ id: "s3", role: "executor", task: "s3", dependsOn: ["s1", "s2"] },
		{ id: "s4", role: "executor", task: "s4", dependsOn: ["s1", "s2"] },
		{ id: "s5", role: "verifier", task: "s5", dependsOn: ["s3", "s4"] },
	]);
	const a = analyzeWorkflowTopology(wf);
	assert.equal(a.topology, "complex-dag");
	assert.equal(a.stepCount, 5);
	assert.equal(a.recommendation, "implementation_adaptive");
	assert.equal(a.dagDepth, 3);
	assert.equal(a.parallelGroupCount, 0);
	assert.equal(a.fanOutDegree, 0);
});

test("DYNAMIC: runtime:'dynamic' workflow skips static analysis", () => {
	const wf: WorkflowConfig = {
		name: "chain",
		description: "chain",
		source: "builtin",
		filePath: "chain.workflow.md",
		runtime: "dynamic",
		dynamicScript: "./chain.dwf.ts",
		steps: [],
	};
	const a = analyzeWorkflowTopology(wf);
	assert.equal(a.topology, "dynamic");
	assert.equal(a.stepCount, 0);
	assert.equal(a.recommendation, "any");
	assert.equal(a.reason, "Chain/dynamic workflow — runtime decides topology");
});

test("parallelGroupsFromSteps returns distinct set", () => {
	const groups = parallelGroupsFromSteps([
		{ id: "a", role: "r", task: "t", parallelGroup: "g1" },
		{ id: "b", role: "r", task: "t", parallelGroup: "g1" },
		{ id: "c", role: "r", task: "t", parallelGroup: "g2" },
		{ id: "d", role: "r", task: "t" },
	]);
	assert.equal(groups.size, 2);
	assert.ok(groups.has("g1"));
	assert.ok(groups.has("g2"));
	assert.equal(parallelGroupsFromSteps([]).size, 0);
});

test("fanOutDegreeFromSteps returns max group size", () => {
	assert.equal(
		fanOutDegreeFromSteps([
			{ id: "a", role: "r", task: "t", parallelGroup: "g1" },
			{ id: "b", role: "r", task: "t", parallelGroup: "g1" },
			{ id: "c", role: "r", task: "t", parallelGroup: "g1" },
			{ id: "d", role: "r", task: "t", parallelGroup: "g2" },
			{ id: "e", role: "r", task: "t" },
		]),
		3,
	);
	assert.equal(fanOutDegreeFromSteps([]), 0);
	assert.equal(
		fanOutDegreeFromSteps([
			{ id: "a", role: "r", task: "t", parallelGroup: "x" },
			{ id: "b", role: "r", task: "t", parallelGroup: "y" },
		]),
		1,
	);
});

test("dagDepthFromSteps computes longest path", () => {
	// diamond: s1, s2 roots; s3, s4 fan-out from s1; s5 joins s3+s4
	const d = dagDepthFromSteps([
		{ id: "s1", role: "r", task: "t" },
		{ id: "s2", role: "r", task: "t" },
		{ id: "s3", role: "r", task: "t", dependsOn: ["s1"] },
		{ id: "s4", role: "r", task: "t", dependsOn: ["s1"] },
		{ id: "s5", role: "r", task: "t", dependsOn: ["s3", "s4"] },
	]);
	assert.equal(d, 3);
	assert.equal(dagDepthFromSteps([]), 0);
	assert.equal(dagDepthFromSteps([{ id: "only", role: "r", task: "t" }]), 1);
	// unknown deps are ignored (treated as root)
	assert.equal(
		dagDepthFromSteps([
			{ id: "a", role: "r", task: "t", dependsOn: ["ghost"] },
			{ id: "b", role: "r", task: "t", dependsOn: ["a"] },
		]),
		2,
	);
	// longest path: when a child has multiple parents, BFS picks the max
	assert.equal(
		dagDepthFromSteps([
			{ id: "a", role: "r", task: "t" },
			{ id: "b", role: "r", task: "t" },
			{ id: "c", role: "r", task: "t", dependsOn: ["a", "b"] },
		]),
		2,
	);
});
