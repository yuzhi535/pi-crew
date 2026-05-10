import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { TeamTaskState } from "../../src/state/types.ts";

/**
 * Creates a minimal valid TeamTaskState with required fields only.
 * Used to verify that new optional fields are truly optional.
 */
function makeMinimalTask(overrides?: Partial<TeamTaskState>): TeamTaskState {
	return {
		id: "task-001",
		runId: "run-001",
		role: "executor",
		agent: "executor",
		title: "Test task",
		status: "queued",
		dependsOn: [],
		cwd: "/tmp",
		...overrides,
	};
}

describe("TeamTaskState — diagnostics field", () => {
	it("accepts task without diagnostics (backward compatible)", () => {
		const task = makeMinimalTask();
		assert.strictEqual(task.diagnostics, undefined);
	});

	it("accepts task with diagnostics", () => {
		const task = makeMinimalTask({
			diagnostics: { toolCalls: 5, filesRead: 3, duration: "2m" },
		});
		assert.deepStrictEqual(task.diagnostics, { toolCalls: 5, filesRead: 3, duration: "2m" });
	});

	it("accepts task with empty diagnostics", () => {
		const task = makeMinimalTask({ diagnostics: {} });
		assert.deepStrictEqual(task.diagnostics, {});
	});
});

describe("TeamTaskState — segment field", () => {
	it("accepts task without segment (backward compatible, defaults to 0)", () => {
		const task = makeMinimalTask();
		assert.strictEqual(task.segment, undefined);
	});

	it("accepts task with segment 0 (first attempt)", () => {
		const task = makeMinimalTask({ segment: 0 });
		assert.strictEqual(task.segment, 0);
	});

	it("accepts task with segment 1 (first retry)", () => {
		const task = makeMinimalTask({ segment: 1 });
		assert.strictEqual(task.segment, 1);
	});

	it("accepts task with higher segment (multiple retries)", () => {
		const task = makeMinimalTask({ segment: 5 });
		assert.strictEqual(task.segment, 5);
	});
});

describe("TeamTaskState — metrics field", () => {
	it("accepts task without metrics (backward compatible)", () => {
		const task = makeMinimalTask();
		assert.strictEqual(task.metrics, undefined);
	});

	it("accepts task with metrics", () => {
		const task = makeMinimalTask({
			metrics: { files_changed: 3, tests_passed: 12, duration_ms: 4500.5 },
		});
		assert.deepStrictEqual(task.metrics, { files_changed: 3, tests_passed: 12, duration_ms: 4500.5 });
	});

	it("accepts task with empty metrics", () => {
		const task = makeMinimalTask({ metrics: {} });
		assert.deepStrictEqual(task.metrics, {});
	});
});

describe("TeamTaskState — all new fields together", () => {
	it("accepts task with all new fields", () => {
		const task = makeMinimalTask({
			diagnostics: { toolCalls: 5 },
			segment: 2,
			metrics: { files_changed: 3 },
		});
		assert.deepStrictEqual(task.diagnostics, { toolCalls: 5 });
		assert.strictEqual(task.segment, 2);
		assert.deepStrictEqual(task.metrics, { files_changed: 3 });
	});

	it("serializes and deserializes with new fields", () => {
		const task = makeMinimalTask({
			diagnostics: { step: "build" },
			segment: 1,
			metrics: { lines: 100 },
		});
		const serialized = JSON.stringify(task);
		const deserialized: TeamTaskState = JSON.parse(serialized);
		assert.deepStrictEqual(deserialized.diagnostics, { step: "build" });
		assert.strictEqual(deserialized.segment, 1);
		assert.deepStrictEqual(deserialized.metrics, { lines: 100 });
	});
});
