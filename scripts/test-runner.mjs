#!/usr/bin/env node
/**
 * Test runner wrapper that enforces non-zero exit code on failures.
 *
 * Problem: `tsx --test` always exits 0 even when tests fail.
 * Fix: Parse output for "# fail N", exit 1 if N > 0.
 *
 * Always passes --test-force-exit so the child process cannot hang the
 * parent (pi) on shutdown. Defensive: prevents the "pi froze" failure
 * mode where a long-running test keeps file handles/timers open and
 * blocks the agent's wait-for-exit.
 *
 * Usage: node scripts/test-runner.mjs [tsx test args...]
 */
import { spawnSync } from "node:child_process";
import process from "node:process";

const args = process.argv.slice(2);
if (args.length === 0) {
	console.error("Usage: node scripts/test-runner.mjs [tsx test args...]");
	process.exit(1);
}

// Always inject --test-force-exit to guarantee child exits (prevents pi hang).
const hasForceExit = args.includes("--test-force-exit");
const finalArgs = hasForceExit ? args : ["--test-force-exit", ...args];

const result = spawnSync(
	process.execPath,
	["--import", "tsx/esm", "--test", ...finalArgs],
	{
		stdio: ["inherit", "pipe", "inherit"],
		encoding: "utf-8",
		env: { ...process.env, NODE_ENV: "test" },
		maxBuffer: 50 * 1024 * 1024, // 50MB for large test output
	},
);

if (result.stdout) {
	process.stdout.write(result.stdout);
}

// Parse final "# fail N" line from test reporter
const failMatches = [...result.stdout.matchAll(/^# fail (\d+)/gm)];
const failCount = failMatches.length > 0
	? parseInt(failMatches[failMatches.length - 1][1], 10)
	: 0;

if (failCount > 0) {
	console.error(`\n❌ ${failCount} test(s) failed — exiting with code 1`);
	process.exit(1);
}

if (result.error) {
	console.error("Test runner error:", result.error.message);
	process.exit(1);
}

process.exit(result.status ?? 0);
