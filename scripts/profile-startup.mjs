#!/usr/bin/env node
/**
 * Profile pi-crew register cold load.
 *
 * Usage:
 *   node scripts/profile-startup.mjs               # default 5 iters
 *   node scripts/profile-startup.mjs --iters 10
 *
 * Outputs:
 *   .profile/startup-<timestamp>.cpuprofile  (open in Chrome DevTools)
 *   .profile/summary.json                    (top frames JSON)
 *
 * Implementation note: spawns a child Node with --cpu-prof so the profile
 * captures only the cold-load path (no measurement noise from this driver).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const profileDir = path.join(root, ".profile");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

const args = process.argv.slice(2);
let iters = 5;
for (let i = 0; i < args.length; i++) {
	if (args[i] === "--iters" && args[i + 1]) {
		iters = Number(args[i + 1]);
		i++;
	}
}

fs.mkdirSync(profileDir, { recursive: true });

const driverPath = path.join(profileDir, `_driver-${timestamp}.mjs`);
const registerImportSpec = pathToFileURL(path.join(root, "src/extension/register.ts")).href;
const driverSrc = `
import { performance } from "node:perf_hooks";
const start = performance.now();
const { registerPiTeams } = await import(${JSON.stringify(registerImportSpec)});
const importMs = performance.now() - start;

function createEvents() {
	const handlers = new Map();
	return {
		on(event, handler) {
			const set = handlers.get(event) ?? new Set();
			set.add(handler);
			handlers.set(event, set);
			return () => set.delete(handler);
		},
		emit(event, payload) {
			for (const h of handlers.get(event) ?? []) h(payload);
		},
	};
}
function createPi(events) {
	return {
		events,
		on(_e, _h) {},
		registerCommand() {},
		registerTool() {},
		appendEntry() {},
		getSessionName() { return undefined; },
		setSessionName() {},
	};
}

const samples = [];
for (let i = 0; i < ${iters}; i++) {
	const t0 = performance.now();
	const events = createEvents();
	const pi = createPi(events);
	registerPiTeams(pi);
	samples.push(performance.now() - t0);
}
process.stdout.write(JSON.stringify({ importMs, samples }) + "\\n");
`;
fs.writeFileSync(driverPath, driverSrc, "utf-8");

const cpuProfilePath = path.join(profileDir, `startup-${timestamp}.cpuprofile`);
console.log(`[profile] Running ${iters} iterations with --cpu-prof...`);

const result = spawnSync(process.execPath, [
	"--cpu-prof",
	`--cpu-prof-dir=${profileDir}`,
	`--cpu-prof-name=startup-${timestamp}.cpuprofile`,
	"--experimental-strip-types",
	"--no-warnings",
	driverPath,
], { encoding: "utf-8", cwd: root });

fs.unlinkSync(driverPath);

if (result.status !== 0) {
	console.error("[profile] driver failed:", result.stderr || result.stdout);
	process.exit(result.status ?? 1);
}

let parsed;
try {
	parsed = JSON.parse(result.stdout.trim().split("\n").pop());
} catch (error) {
	console.error("[profile] could not parse driver output:", result.stdout);
	process.exit(2);
}

const samples = parsed.samples;
samples.sort((a, b) => a - b);
const p = (q) => samples[Math.min(samples.length - 1, Math.floor((samples.length - 1) * q))];
const summary = {
	timestamp,
	iters,
	importMs: round(parsed.importMs),
	registerMs: { min: round(samples[0]), p50: round(p(0.5)), p95: round(p(0.95)), p99: round(p(0.99)), max: round(samples[samples.length - 1]) },
	cpuProfile: path.relative(root, cpuProfilePath).replace(/\\/g, "/"),
};
fs.writeFileSync(path.join(profileDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n", "utf-8");

console.log("[profile] Summary:", JSON.stringify(summary, null, 2));
console.log("[profile] CPU profile:", cpuProfilePath);
console.log("[profile] Open in Chrome DevTools → Performance → Load profile.");

function round(n) { return Math.round(n * 100) / 100; }
