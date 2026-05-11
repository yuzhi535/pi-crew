import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
	runIterationHook,
	steerMessageFromHook,
	hookLogEntry,
} from "../../src/runtime/iteration-hooks.ts";
import type { HookPayload, HookResult, HookStage } from "../../src/runtime/iteration-hooks.ts";

/** Helper to create a standard hook payload. */
function makePayload(overrides: Partial<HookPayload> = {}): HookPayload {
	return {
		event: "before",
		cwd: os.tmpdir(),
		taskId: "task-1",
		runId: "run-1",
		taskRole: "agent",
		session: {
			teamName: "test-team",
			workflowName: "default",
			goal: "test goal",
			completedTasks: 0,
			totalTasks: 2,
		},
		...overrides,
	};
}

describe("runIterationHook", () => {
	it("returns notFired when script doesn't exist", async () => {
		const payload = makePayload();
		const result = await runIterationHook(
			payload,
			"/nonexistent/path/hook.sh",
		);

		assert.equal(result.fired, false);
		assert.equal(result.stdout, "");
		assert.equal(result.stderr, "");
		assert.equal(result.exitCode, null);
		assert.equal(result.timedOut, false);
		assert.equal(result.durationMs, 0);
	});

	it("fires and captures stdout when script succeeds with output", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-hook-"));
		try {
			const scriptPath = path.join(dir, "success.sh");
			fs.writeFileSync(
				scriptPath,
				'#!/bin/bash\nread input\necho "hook-output: $input"\nexit 0\n',
			);
			fs.chmodSync(scriptPath, 0o755);

			const payload = makePayload({ cwd: dir });
			const result = await runIterationHook(payload, scriptPath);

			assert.equal(result.fired, true);
			assert.equal(result.exitCode, 0);
			assert.equal(result.timedOut, false);
			assert.ok(result.stdout.includes("hook-output:"));
			assert.ok(result.durationMs >= 0);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("fires and captures stderr when script exits non-zero", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-hook-"));
		try {
			const scriptPath = path.join(dir, "fail.sh");
			fs.writeFileSync(
				scriptPath,
				'#!/bin/bash\necho "error message" >&2\nexit 1\n',
			);
			fs.chmodSync(scriptPath, 0o755);

			const payload = makePayload({ cwd: dir });
			const result = await runIterationHook(payload, scriptPath);

			assert.equal(result.fired, true);
			assert.equal(result.exitCode, 1);
			assert.equal(result.timedOut, false);
			assert.ok(result.stderr.includes("error message"));
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("reports timeout when script runs longer than timeout", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-hook-"));
		try {
			const scriptPath = path.join(dir, "slow.sh");
			// Sleep for 5 seconds — will be killed by the 2s timeout passed below
			fs.writeFileSync(
				scriptPath,
				"#!/bin/bash\nsleep 5\necho done\nexit 0\n",
			);
			fs.chmodSync(scriptPath, 0o755);

			const payload = makePayload({ cwd: dir });
			const result = await runIterationHook(payload, scriptPath, { timeoutMs: 2000 });

			assert.equal(result.fired, true);
			assert.equal(result.timedOut, true);
			assert.ok(result.durationMs >= 1_500);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("truncates stdout at 8KB boundary on newline", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-hook-"));
		try {
			const scriptPath = path.join(dir, "verbose.sh");
			// Generate ~16KB of output with lines
			fs.writeFileSync(
				scriptPath,
				'#!/bin/bash\nfor i in $(seq 1 1000); do echo "Line $i: padding-padding-padding-padding-padding-padding-padding"; done\nexit 0\n',
			);
			fs.chmodSync(scriptPath, 0o755);

			const payload = makePayload({ cwd: dir });
			const result = await runIterationHook(payload, scriptPath);

			assert.equal(result.fired, true);
			assert.equal(result.exitCode, 0);
			// stdout should be truncated to <= 8KB
			assert.ok(
				result.stdout.length <= 8192,
				`stdout length ${result.stdout.length} exceeds 8KB`,
			);
			// Should contain valid content (truncation happened)
			assert.ok(result.stdout.length > 0, "should have some output");
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("returns notFired for non-existent script path", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-hook-"));
		try {
			const scriptPath = path.join(dir, "missing.sh");
			// Script doesn't exist at all

			const payload = makePayload({ cwd: dir });
			const result = await runIterationHook(payload, scriptPath);

			assert.equal(result.fired, false);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("steerMessageFromHook", () => {
	it("returns null for notFired result", () => {
		const result: HookResult = {
			fired: false,
			stdout: "",
			stderr: "",
			exitCode: null,
			timedOut: false,
			durationMs: 0,
		};
		assert.equal(steerMessageFromHook("before", result), null);
	});

	it("returns trimmed stdout for successful hook with output", () => {
		const result: HookResult = {
			fired: true,
			stdout: "  proceed with plan  \n",
			stderr: "",
			exitCode: 0,
			timedOut: false,
			durationMs: 100,
		};
		const msg = steerMessageFromHook("after", result);
		assert.equal(msg, "proceed with plan");
	});

	it("returns null for successful hook with empty stdout", () => {
		const result: HookResult = {
			fired: true,
			stdout: "   \n  \n",
			stderr: "",
			exitCode: 0,
			timedOut: false,
			durationMs: 50,
		};
		assert.equal(steerMessageFromHook("after", result), null);
	});

	it("returns error steer message for non-zero exit code", () => {
		const result: HookResult = {
			fired: true,
			stdout: "",
			stderr: "something went wrong",
			exitCode: 1,
			timedOut: false,
			durationMs: 200,
		};
		const msg = steerMessageFromHook("before", result);
		assert.ok(msg !== null);
		assert.ok(msg!.includes("[before-hook]"));
		assert.ok(msg!.includes("exited with code 1"));
		assert.ok(msg!.includes("something went wrong"));
	});

	it("returns timeout steer message for timed out hook", () => {
		const result: HookResult = {
			fired: true,
			stdout: "",
			stderr: "",
			exitCode: null,
			timedOut: true,
			durationMs: 30_000,
		};
		const msg = steerMessageFromHook("after", result);
		assert.ok(msg !== null);
		assert.ok(msg!.includes("[after-hook]"));
		assert.ok(msg!.includes("timed out"));
	});

	it("filters denied metric names from hook output", () => {
		const result: HookResult = {
			fired: true,
			stdout: "CREW_METRIC __proto__=42\nCREW_METRIC valid_count=7\nCREW_METRIC constructor=99\n",
			stderr: "",
			exitCode: 0,
			timedOut: false,
			durationMs: 100,
		};
		const msg = steerMessageFromHook("after", result);
		assert.ok(msg !== null);
		assert.ok(!msg!.includes("__proto__"));
		assert.ok(!msg!.includes("constructor"));
		assert.ok(msg!.includes("CREW_METRIC valid_count=7"));
	});
});

describe("hookLogEntry", () => {
	it("produces minimal entry for notFired result", () => {
		const result: HookResult = {
			fired: false,
			stdout: "",
			stderr: "",
			exitCode: null,
			timedOut: false,
			durationMs: 0,
		};
		const entry = hookLogEntry("before", result);

		assert.equal(entry.type, "iteration-hook");
		assert.equal(entry.stage, "before");
		assert.equal(entry.fired, false);
		assert.equal(entry.durationMs, 0);
		assert.equal(entry.exitCode, undefined);
		assert.equal(entry.timedOut, undefined);
	});

	it("includes exitCode and stdout/stderr previews for fired result", () => {
		const result: HookResult = {
			fired: true,
			stdout: "hook output here",
			stderr: "some stderr",
			exitCode: 0,
			timedOut: false,
			durationMs: 150,
		};
		const entry = hookLogEntry("after", result);

		assert.equal(entry.fired, true);
		assert.equal(entry.exitCode, 0);
		assert.equal(entry.timedOut, false);
		assert.equal(entry.stdoutPreview, "hook output here");
		assert.equal(entry.stderrPreview, "some stderr");
	});

	it("includes timedOut flag for timed-out results", () => {
		const result: HookResult = {
			fired: true,
			stdout: "",
			stderr: "",
			exitCode: null,
			timedOut: true,
			durationMs: 30_000,
		};
		const entry = hookLogEntry("before", result);

		assert.equal(entry.timedOut, true);
	});
});
