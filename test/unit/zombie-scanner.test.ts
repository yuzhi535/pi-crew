/**
 * Tests for the pi-crew sub-agent process-identity marker + zombie scanner.
 *
 * Lesson context: an earlier heuristic-based zombie "cleanup" killed a live
 * main `pi` session by accident. The fix is an AUTHORITATIVE marker —
 * `--crew-subagent` (argv) + `PI_CREW_KIND=subagent` (env) — set on every
 * child-pi spawn. The user's main session never carries the marker, so it
 * can never be matched by zombie detection.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildPiWorkerArgs } from "../../src/runtime/pi-args.ts";
import { scanZombieSubagents, formatZombieReport } from "../../src/runtime/zombie-scanner.ts";
import type { AgentConfig } from "../../src/agents/agent-config.ts";

function fakeAgent(): AgentConfig {
	return {
		name: "executor",
		description: "test",
		source: "builtin",
		filePath: "<test>",
		systemPrompt: "You are a test agent.",
		tools: [],
		inheritProjectContext: false,
		inheritSkills: false,
	};
}

test("buildPiWorkerArgs: prepends --crew-subagent as the FIRST argv flag", () => {
	const { args } = buildPiWorkerArgs({ task: "do thing", agent: fakeAgent() });
	assert.equal(args[0], "--crew-subagent", "first argv flag must be the sub-agent marker so ps shows it");
	assert.ok(args.includes("--mode"), "regular flags still present after the marker");
});

test("buildPiWorkerArgs: sets PI_CREW_KIND=subagent in the child env", () => {
	const { env } = buildPiWorkerArgs({ task: "do thing", agent: fakeAgent() });
	assert.equal(env.PI_CREW_KIND, "subagent", "PI_CREW_KIND=subagent is the authoritative machine marker");
});

test("buildPiWorkerArgs: a MAIN session env never has PI_CREW_KIND (sanity check)", () => {
	// This is the inverse guarantee: the marker is ONLY added by buildPiWorkerArgs.
	// The parent process (this test) is a main-session equivalent — it must NOT
	// carry the marker, otherwise doctor --zombies could match it.
	assert.notEqual(process.env.PI_CREW_KIND, "subagent", "main session must not self-identify as subagent");
});

test("scanZombieSubagents: returns a well-formed result object", () => {
	const scan = scanZombieSubagents();
	// Shape contract — never throws, always returns {zombies, live, errors}.
	assert.ok(Array.isArray(scan.zombies));
	assert.ok(Array.isArray(scan.live));
	assert.ok(Array.isArray(scan.errors));
});

test("scanZombieSubagents: never lists a main session (no PI_CREW_KIND marker)", () => {
	// The current process is NOT a pi-crew sub-agent (no PI_CREW_KIND=subagent),
	// so it must NEVER appear in zombies OR live — even though it IS a node/pi
	// process. This is the regression test for the accidental-kill incident.
	const scan = scanZombieSubagents();
	const myPid = process.pid;
	const matched = [...scan.zombies, ...scan.live].filter((z) => z.pid === myPid);
	assert.equal(matched.length, 0, "main session must never be matched as a sub-agent");
});

test("scanZombieSubagents: every matched entry carries PI_CREW_KIND=subagent by construction", () => {
	// Defense in depth: even if some other process slips in, the scanner only
	// emits entries that originated from a process with PI_CREW_KIND=subagent.
	// (We can't easily forge a /proc entry in a unit test, but we can assert
	// the scanner's contract: zombies/live arrays only contain ZombieSubagent
	// objects with numeric pid + crewParentPid fields.)
	const scan = scanZombieSubagents();
	for (const z of [...scan.zombies, ...scan.live]) {
		assert.equal(typeof z.pid, "number");
		assert.equal(typeof z.crewParentPid, "number");
		assert.equal(typeof z.parentAlive, "boolean");
	}
});

test("formatZombieReport: render is human-readable and states read-only safety", () => {
	const scan = scanZombieSubagents();
	const text = formatZombieReport(scan);
	assert.match(text, /read-only/i, "report must clearly state it does not kill");
	assert.match(text, /PI_CREW_KIND=subagent/i, "report must explain the authoritative marker");
	// No zombie or live entry should leak a raw suggestion to kill live parents.
	if (scan.live.length > 0) {
		assert.match(text, /NOT zombies/i, "live entries must be marked do-not-kill");
	}
});

test("formatZombieReport: empty scan renders a clean 'nothing found' message", () => {
	const text = formatZombieReport({ zombies: [], live: [], errors: [] });
	assert.match(text, /No pi-crew sub-agent processes found/i);
});
