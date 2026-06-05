#!/usr/bin/env -S npx tsx
/**
 * Crash reproduction test for issue #29: verifies the defense-in-depth fix
 * in subagent-manager.ts:start() prevents unhandled rejections from
 * crashing the host process.
 *
 * Strategy: spawn a subagent whose runner throws, then do NOT await
 * record.promise. Without the fix, this triggers unhandledRejection which
 * Node.js converts to uncaughtException. With the fix, the .catch inside
 * start() absorbs the rejection.
 *
 * Run with: npx tsx scripts/test-issue-29-crash.ts
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const tmpDir = fs.mkdtempSync(
	path.join(os.tmpdir(), "pi-crew-issue-29-crash-"),
);
fs.mkdirSync(path.join(tmpDir, ".pi"), { recursive: true });

console.log("Issue #29 CRASH reproduction test");
console.log(`Project: ${tmpDir}`);
console.log();

let crashed = false;
let crashError: Error | undefined;
const crashEvents: string[] = [];

process.on("uncaughtException", (error) => {
	crashed = true;
	crashError = error;
	crashEvents.push(`uncaughtException: ${error.message}`);
	console.error(`[CRASH] uncaughtException: ${error.message}`);
});

process.on("unhandledRejection", (reason) => {
	crashed = true;
	const err = reason instanceof Error ? reason : new Error(String(reason));
	crashError = err;
	crashEvents.push(`unhandledRejection: ${err.message}`);
	console.error(`[CRASH] unhandledRejection: ${err.message}`);
});

async function main(): Promise<void> {
	const piCrewRoot = path.resolve(
		path.dirname(fileURLToPath(import.meta.url)),
		"..",
	);
	const { SubagentManager } = await import(
		path.join(piCrewRoot, "src/runtime/subagent-manager.ts")
	);

	const mgr = new SubagentManager();

	const runnerThatThrows = async (): Promise<never> => {
		throw new Error("simulated subagent failure (issue #29 crash test)");
	};

	const record = mgr.spawn(
		{
			cwd: tmpDir,
			type: "test",
			description: "issue-29 crash test",
			prompt: "throw",
			background: false,
		},
		runnerThatThrows as Parameters<typeof mgr.spawn>[1],
	);

	console.log(`Spawned subagent ${record.id}`);

	// Do NOT await — this is the scenario that crashes pi.
	console.log("Waiting 300ms without awaiting record.promise...");
	await new Promise((resolve) => setTimeout(resolve, 300));

	console.log();
	console.log(`Results:`);
	console.log(`  record.status = ${record.status}`);
	console.log(`  process.crashed = ${crashed}`);
	console.log(`  crashEvents = ${JSON.stringify(crashEvents)}`);
	console.log();

	fs.rmSync(tmpDir, { recursive: true, force: true });

	if (crashed) {
		console.error(
			"✗ FAIL: process crashed (uncaughtException/unhandledRejection fired)",
		);
		console.error(
			"  The defense-in-depth fix in subagent-manager.ts did NOT prevent the crash.",
		);
		if (crashError?.stack) {
			console.error("  Stack trace:");
			console.error(
				crashError.stack
					.split("\n")
					.slice(0, 10)
					.map((l) => `    ${l}`)
					.join("\n"),
			);
		}
		process.exit(1);
	}

	if (record.status !== "error") {
		console.error(
			`✗ FAIL: record.status should be 'error', got '${record.status}'`,
		);
		process.exit(1);
	}

	console.log("✓ PASS: no crash, record marked 'error'");
	process.exit(0);
}

main().catch((error) => {
	console.error("Test script itself crashed:");
	console.error(error);
	process.exit(1);
});
