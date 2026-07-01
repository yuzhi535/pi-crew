/**
 * pi-crew entrypoint — v0.9.17+ bundle-aware.
 *
 * Resolution order:
 *   1. If `dist/index.mjs` exists, load it (single-file 2.9MB bundle).
 *      Faster cold-start, no per-file strip-types parse cost. Built by
 *      `npm run build:bundle` (or auto-built by postinstall).
 *   2. Else, fall back to inline strip-types loading. This keeps the
 *      extension loadable in dev clones where dist/ hasn't been built,
 *      and prevents postinstall failures from breaking pi startup.
 *
 * The fallback path is intentionally permissive — we'd rather pay
 * strip-types overhead than throw "bundle missing" at startup. Slow
 * beats broken. Logging is intentionally absent to avoid spamming pi
 * startup output; run `npm run build:bundle` to upgrade to the fast
 * path.
 *
 * Design notes (Phase 5 H2 follow-up):
 *   - We use dynamic import + try/catch rather than top-level await
 *     because Pi's loader does not consistently support TLA across
 *     extension entrypoints in all versions.
 *   - Strip-types fallback is computed at module-evaluation time, not
 *     runtime — switching paths mid-session is not supported.
 *   - We never read process.env here; build automation is the user's
 *     responsibility (postinstall + git pre-commit hook).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerPiTeams as registerPiTeamsFromSrc } from "./src/extension/register.ts";
import { waitForRun as waitForRunFromSrc } from "./src/runtime/run-tracker.ts";
import { accessSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const bundlePath = resolve(here, "dist", "index.mjs");

// Minimal bundle shape — we only use a few named exports. Keep this loose
// because dist/index.mjs has no .d.ts (it's a build artifact, not source).
type BundleModule = {
	default?: (pi: ExtensionAPI) => void;
	waitForRun?: typeof waitForRunFromSrc;
	registerPiTeams?: (pi: ExtensionAPI) => void;
};

let bundleModule: BundleModule | undefined;
try {
	accessSync(bundlePath);
	// Lazy import: don't pay the parse cost when bundle is missing,
	// but DO pay it (once) when present. This keeps the strip-types
	// path cheap in dev.
	bundleModule = await import(bundlePath);
} catch {
	// Bundle missing or unreadable. Fall through to strip-types path
	// below. This is the graceful fallback — see header comment.
	bundleModule = undefined;
}

export const waitForRun = bundleModule?.waitForRun ?? waitForRunFromSrc;
export const registerPiTeams: (pi: ExtensionAPI) => void =
	bundleModule?.registerPiTeams ?? registerPiTeamsFromSrc;

export default bundleModule?.default ?? ((pi: ExtensionAPI) => registerPiTeamsFromSrc(pi));