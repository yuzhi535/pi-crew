import * as fs from "node:fs";
import * as path from "node:path";
import { assertRunBundle } from "./run-bundle-schema.ts";
import { projectCrewRoot, userCrewRoot } from "../utils/paths.ts";
import { DEFAULT_PATHS } from "../config/defaults.ts";
import { assertSafePathId, resolveContainedRelativePath, resolveRealContainedPath } from "../utils/safe-paths.ts";
import { detectImportConflicts, type ConflictReport } from "../runtime/delta-conflict.ts";

export interface ImportedRunBundleInfo {
	runId: string;
	importedAt: string;
	bundlePath: string;
	summaryPath: string;
	conflictReport?: ConflictReport;
}

function importRoot(cwd: string, scope: "project" | "user"): string {
	const base = scope === "project" ? projectCrewRoot(cwd) : userCrewRoot();
	// SECURITY NOTE: `DEFAULT_PATHS.state.importsSubdir` is a constant (not user-controlled).
	// If this constant ever becomes user-influenced, this function could become a path
	// traversal risk. Always keep `importsSubdir` as a hardcoded constant. Do NOT accept
	// `importsSubdir` as a parameter or from config.
	return path.join(base, DEFAULT_PATHS.state.importsSubdir);
}

export function importRunBundle(cwd: string, bundlePath: string, scope: "project" | "user" = "project"): ImportedRunBundleInfo {
	const resolvedPath = path.isAbsolute(bundlePath) ? bundlePath : path.resolve(cwd, bundlePath);
	// Path containment: use resolveRealContainedPath for canonical real-path check
	// to prevent symlink/../ bypass of the startsWith string comparison.
	const allowedBases: string[] = [];
	try { allowedBases.push(userCrewRoot()); } catch { /* ignore */ }
	try { allowedBases.push(projectCrewRoot(cwd)); } catch { /* ignore */ }
	allowedBases.push(cwd); // always include cwd last (highest priority)
	let isContained = false;
	for (const base of allowedBases) {
		try {
			resolveRealContainedPath(base, resolvedPath);
			isContained = true;
			break;
		} catch { /* not contained — try next base */ }
	}
	if (!isContained) throw new Error(`Import path must be within project directory or crew root: ${resolvedPath}`);
	const raw = JSON.parse(fs.readFileSync(resolvedPath, "utf-8")) as unknown;
	assertRunBundle(raw);
	const runId = assertSafePathId("runId", raw.manifest.runId);
	const importedAt = new Date().toISOString();

	// Non-blocking conflict detection: compare incoming bundle against any existing state.
	let conflictReport: ConflictReport | undefined;
	try {
		const existingManifestPath = path.join(importRoot(cwd, scope), runId, "run-export.json");
		if (fs.existsSync(existingManifestPath)) {
			const existingRaw = JSON.parse(fs.readFileSync(existingManifestPath, "utf-8")) as { manifest?: Record<string, unknown>; tasks?: unknown[] };
			conflictReport = detectImportConflicts(
				{ manifest: raw.manifest as unknown as Record<string, unknown>, tasks: raw.tasks as unknown[] },
				{ manifest: existingRaw.manifest, tasks: existingRaw.tasks },
			);
		}
	} catch {
		// Conflict detection is best-effort; do not block import on failure.
	}

	const importsRoot = importRoot(cwd, scope);
	fs.mkdirSync(importsRoot, { recursive: true });
	if (fs.lstatSync(importsRoot).isSymbolicLink()) throw new Error(`Invalid import root: ${importsRoot}`);
	resolveRealContainedPath(path.dirname(importsRoot), path.basename(importsRoot));
	const root = resolveContainedRelativePath(importsRoot, runId, "runId");
	fs.mkdirSync(root, { recursive: true });
	// TOCTOU note: mkdirSync would throw EEXIST if a symlink already existed.
	// The lstatSync check catches a symlink swapped in between mkdirSync and the check
	// (theoretically possible but requires local attacker with exact timing).
	// resolveRealContainedPath provides an additional real-path containment barrier.
	if (fs.lstatSync(root).isSymbolicLink()) throw new Error(`Invalid import directory: ${root}`);
	resolveRealContainedPath(importsRoot, runId);
	const targetJson = path.join(root, "run-export.json");
	const targetSummary = path.join(root, "README.md");
	for (const target of [targetJson, targetSummary]) {
		if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error(`Invalid import target: ${target}`);
	}
	fs.writeFileSync(targetJson, `${JSON.stringify({ ...raw, importedAt, importedFrom: resolvedPath }, null, 2)}\n`, "utf-8");
	fs.writeFileSync(targetSummary, [
		`# Imported pi-crew run ${runId}`,
		"",
		`Imported: ${importedAt}`,
		`Source: ${resolvedPath}`,
		`Original export: ${raw.exportedAt}`,
		`Status: ${raw.manifest.status}`,
		`Team: ${raw.manifest.team}`,
		`Workflow: ${raw.manifest.workflow ?? "(none)"}`,
		`Goal: ${raw.manifest.goal}`,
		"",
		"## Tasks",
		...raw.tasks.map((task) => `- ${task.id}: ${task.status} (${task.role} -> ${task.agent})${task.error ? ` - ${task.error}` : ""}`),
		"",
	].join("\n"), "utf-8");
	return { runId, importedAt, bundlePath: targetJson, summaryPath: targetSummary, ...(conflictReport?.hasConflicts ? { conflictReport } : {}) };
}