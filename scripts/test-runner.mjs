#!/usr/bin/env node
/**
 * Test runner wrapper that enforces non-zero exit code on failures.
 *
 * Problem: `tsx --test` always exits 0 even when tests fail.
 * Fix: Use stdio: 'inherit' so output streams directly (avoids pipe buffer
 * deadlocks on large test suites), and rely on the child's exit code.
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
	// When run by Node's test runner (no args), exit 0 gracefully.
	// This script needs test file arguments to do anything useful.
	console.log("skip: no test files specified");
	process.exit(0);
}

// Always inject --test-force-exit to guarantee child exits (prevents pi hang).
const hasForceExit = args.includes("--test-force-exit");
let finalArgs = hasForceExit ? args : ["--test-force-exit", ...args];

// Windows hardening: node:test runs test FILES concurrently in one process
// (--test-concurrency=N). On the GitHub Actions windows-latest runner, real-
// time antivirus scanning of freshly-created temp files causes transient
// EPERM/EBUSY on rename/rename-source inside atomicWriteFile. Under high
// concurrency (4+) this happens often enough to exhaust the rename retries
// (~1.6s of backoff) and fail write-then-stat tests (notably state-store's
// createRunManifest assertions). Lowering cross-file concurrency on Windows
// gives the FS / AV scanner room to flush, eliminating the contention storm.
// mac/ubuntu are unaffected (no AV scan lock) and keep the requested value.
if (process.platform === "win32") {
	finalArgs = finalArgs.map((arg) => {
		const m = /^--test-concurrency=(\d+)$/.exec(arg);
		return m && Number(m[1]) > 2 ? "--test-concurrency=2" : arg;
	});
}

const result = spawnSync(
	process.execPath,
	["--import", "tsx/esm", "--test", ...finalArgs],
	{
		stdio: "inherit",
		env: { ...process.env, NODE_ENV: "test" },
		timeout: 600_000, // 10 minute overall timeout
	},
);

if (result.error) {
	console.error("Test runner error:", result.error.message);
	process.exit(1);
}

// The Node.js test runner exits with non-zero when tests fail.
// With --test-force-exit, it may exit with code 1 if force-exited
// while tests were still running (which shouldn't happen normally).
process.exit(result.status ?? 0);
