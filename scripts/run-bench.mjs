#!/usr/bin/env node
/**
 * Run all benches, collect JSON output, write to test/bench/results.json.
 *
 * Each bench prints a single JSON line on stdout (NDJSON). Earlier lines may
 * be ignored. Failures abort the run.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const benchDir = path.join(root, "test", "bench");
const benches = fs.readdirSync(benchDir).filter((f) => f.endsWith(".bench.ts"));

const results = {};
for (const bench of benches) {
	const benchPath = path.join(benchDir, bench);
	console.log(`[bench] running ${bench}...`);
	const t0 = Date.now();
	const result = spawnSync(process.execPath, [
		"--experimental-strip-types",
		"--no-warnings",
		benchPath,
	], { encoding: "utf-8", cwd: root, timeout: 600_000 });
	if (result.status !== 0) {
		console.error(result.stderr || result.stdout);
		process.exit(result.status ?? 1);
	}
	const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
	const lines = result.stdout.trim().split("\n").filter(Boolean);
	let parsed;
	for (const line of lines.reverse()) {
		try { parsed = JSON.parse(line); break; } catch { /* skip non-JSON */ }
	}
	if (!parsed?.name) {
		console.error(`[bench] could not parse JSON output from ${bench}\n${result.stdout}`);
		process.exit(2);
	}
	results[parsed.name] = parsed;
	console.log(`[bench]   ${parsed.name} done in ${elapsed}s`);
}

const outPath = path.join(benchDir, "results.json");
const payload = { capturedAt: new Date().toISOString(), node: process.version, platform: process.platform, results };
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n", "utf-8");
console.log(`[bench] wrote ${outPath}`);
