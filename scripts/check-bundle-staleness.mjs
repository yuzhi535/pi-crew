#!/usr/bin/env node
/**
 * CI gate: detect stale dist/index.mjs vs src/.
 *
 * Compares the newest mtime in src/ against dist/index.mjs mtime. If
 * src/ is newer, the bundle is stale (someone edited source without
 * rebuilding). Exits non-zero in that case.
 *
 * Why: in v0.9.17 the entrypoint prefers the bundle (with strip-types
 * fallback). Stale bundles silently run old code — see Phase 5 H2
 * investigation (2026-07-01) for the regression risk.
 *
 * Skips if dist/index.mjs does not exist (the strip-types fallback path
 * is fine and the build:bundle automation will produce it).
 *
 * Exits:
 *   0 — dist is fresh OR absent
 *   1 — dist is stale (run `npm run build:bundle`)
 */

import { execSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";

const distPath = "dist/index.mjs";
if (!existsSync(distPath)) {
	console.log("[check-bundle-staleness] dist/index.mjs absent — strip-types fallback will be used. OK.");
	process.exit(0);
}

const distMtimeMs = statSync(distPath).mtimeMs;

// `git ls-files -o -- src` lists untracked files in src/. We want every
// tracked file's mtime plus the newest untracked one. Cheap heuristic:
// use `find` style by asking git for the full list, then statSync each.
let trackedFiles;
try {
	trackedFiles = execSync(`git ls-files src`, { encoding: "utf-8" })
		.split("\n")
		.filter(Boolean);
} catch {
	// Not a git repo (e.g. npm pack test) — skip.
	console.log("[check-bundle-staleness] not a git repo; skipping staleness check.");
	process.exit(0);
}

let newestMtimeMs = 0;
let newestFile = "";
for (const f of trackedFiles) {
	try {
		const mt = statSync(f).mtimeMs;
		if (mt > newestMtimeMs) {
			newestMtimeMs = mt;
			newestFile = f;
		}
	} catch {
		// File listed but missing on disk — ignore.
	}
}

// Add untracked .ts files in src/ (devs editing a new file)
try {
	const untracked = execSync(`git ls-files -o --exclude-standard src`, { encoding: "utf-8" })
		.split("\n")
		.filter(Boolean);
	for (const f of untracked) {
		if (!f.endsWith(".ts")) continue;
		try {
			const mt = statSync(f).mtimeMs;
			if (mt > newestMtimeMs) {
				newestMtimeMs = mt;
				newestFile = f;
			}
		} catch {
			// ignore
		}
	}
} catch {
	// git may fail; ignore
}

if (newestMtimeMs === 0) {
	console.log("[check-bundle-staleness] no src/*.ts files found; skipping.");
	process.exit(0);
}

if (newestMtimeMs > distMtimeMs) {
	console.error(
		`[check-bundle-staleness] FAIL: dist/index.mjs is stale.\n` +
			`  Newest src file: ${newestFile} (mtime=${newestMtimeMs.toFixed(0)})\n` +
			`  dist/index.mjs mtime: ${distMtimeMs.toFixed(0)}\n` +
			`  → run \`npm run build:bundle\` to refresh.`,
	);
	process.exit(1);
}

const ageSec = (distMtimeMs - newestMtimeMs) / 1000;
console.log(`[check-bundle-staleness] OK: dist/index.mjs is ${ageSec.toFixed(1)}s newer than newest src/ file.`);