import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export function packageRoot(): string {
	return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export function userPiRoot(): string {
	const home = process.env.PI_TEAMS_HOME?.trim() || os.homedir();
	const resolved = path.join(home, ".pi", "agent");

	// Validate that the resolved path is owned by the current user
	// to ensure security assumptions about file permissions (0o600/0o700) hold.
	// Skip check if the directory does not exist yet.
	try {
		const stats = fs.statSync(resolved);
		if (stats.uid !== os.userInfo().uid) {
			throw new Error(
				`userPiRoot: PI_TEAMS_HOME path "${resolved}" is not owned by the current user (uid=${os.userInfo().uid}, found uid=${stats.uid}). ` +
				"This violates security assumptions about file permissions. Set PI_TEAMS_HOME to a path owned by the current user, or unset it to use the default.",
			);
		}
	} catch (err: unknown) {
		if (err instanceof Error && "code" in err && err.code !== "ENOENT") {
			throw err;
		}
		// ENOENT is acceptable — the directory may not exist yet.
	}

	return resolved;
}

const PROJECT_DIR_MARKERS = [".git", ".pi", ".crew", ".hg", ".svn", ".factory", ".omc"];
const PROJECT_FILE_MARKERS = ["package.json", "pyproject.toml", "Cargo.toml", "go.mod", "pom.xml", "composer.json", "build.gradle", "build.gradle.kts"];

// 2.10 — cache findRepoRoot results so repeated lookups during render ticks
// (loadConfig, state-store helpers, powerbar, snapshot-cache, ...) skip the
// 14 existsSync calls per ancestor level. TTL is short enough that a freshly
// `git init`-ed marker is picked up within ~30s without forcing manual
// invalidation in interactive sessions.
const PROJECT_ROOT_CACHE_TTL_MS = 30_000;
const PROJECT_ROOT_CACHE_MAX_ENTRIES = 32;
interface ProjectRootCacheEntry {
	repoRoot: string | undefined;
	cachedAt: number;
}
const projectRootCache = new Map<string, ProjectRootCacheEntry>();

function evictOldestProjectRoot(): void {
	const oldest = projectRootCache.keys().next().value;
	if (oldest !== undefined) projectRootCache.delete(oldest);
}

/** Drop all cached findRepoRoot results. Call from cleanupRuntime / tests. */
export function clearProjectRootCache(): void {
	projectRootCache.clear();
}

function hasProjectMarker(dir: string): boolean {
	for (const marker of PROJECT_DIR_MARKERS) {
		if (fs.existsSync(path.join(dir, marker))) return true;
	}
	for (const file of PROJECT_FILE_MARKERS) {
		if (fs.existsSync(path.join(dir, file))) return true;
	}
	return false;
}

export function findRepoRoot(cwd: string): string | undefined {
	const startKey = path.resolve(cwd);
	const cached = projectRootCache.get(startKey);
	if (cached && Date.now() - cached.cachedAt < PROJECT_ROOT_CACHE_TTL_MS) {
		// Re-insert to refresh LRU position.
		projectRootCache.delete(startKey);
		projectRootCache.set(startKey, cached);
		return cached.repoRoot;
	}
	const result = computeRepoRoot(startKey);
	projectRootCache.set(startKey, { repoRoot: result, cachedAt: Date.now() });
	while (projectRootCache.size > PROJECT_ROOT_CACHE_MAX_ENTRIES) evictOldestProjectRoot();
	return result;
}

function computeRepoRoot(start: string): string | undefined {
	let current = start;
	const root = path.parse(current).root;
	const home = path.resolve(os.homedir());
	const tempRoot = path.resolve(os.tmpdir());
	while (current !== root) {
		// Stop walking before checking markers at home or temp root
		if (current === home || current === tempRoot) return undefined;
		if (hasProjectMarker(current)) return current;
		const parent = path.dirname(current);
		if (parent === current) break;
		current = parent;
	}
	if (current === home || current === tempRoot) return undefined;
	if (hasProjectMarker(root)) return root;
	return undefined;
}

export function projectPiRoot(cwd: string): string {
	return path.join(findRepoRoot(cwd) ?? cwd, ".pi");
}

export function projectCrewRoot(cwd: string): string {
	const repoRoot = findRepoRoot(cwd) ?? cwd;
	const crewDir = path.join(repoRoot, ".crew");
	// Keep an existing .crew/ stable even when .pi/ exists for project config.
	if (fs.existsSync(crewDir)) return crewDir;
	// Legacy reuse: if .pi/ already exists for the project, namespace under .pi/teams/
	// to avoid creating a parallel .crew/ alongside an existing pi project layout.
	const piDir = path.join(repoRoot, ".pi");
	if (fs.existsSync(piDir)) return path.join(piDir, "teams");
	return crewDir;
}

export function userCrewRoot(): string {
	return path.join(userPiRoot(), "extensions", "pi-crew");
}
