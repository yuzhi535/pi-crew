import * as fs from "node:fs";
import * as path from "node:path";
import type { TeamRunManifest, TeamTaskState } from "./types.ts";
import { canTransitionRunStatus } from "./contracts.ts";
import { unregisterActiveRun } from "./active-run-registry.ts";
import { atomicWriteJson, atomicWriteJsonAsync, atomicWriteJsonCoalesced, readJsonFile } from "./atomic-write.ts";
import { appendEvent } from "./event-log.ts";
import { DEFAULT_CACHE, DEFAULT_PATHS } from "../config/defaults.ts";
import { createRunId, createTaskId } from "../utils/ids.ts";
import { findRepoRoot, projectCrewRoot, userCrewRoot } from "../utils/paths.ts";
import { assertSafePathId, resolveContainedRelativePath, resolveRealContainedPath } from "../utils/safe-paths.ts";
import { withRunLock } from "./locks.ts";
import { logInternalError } from "../utils/internal-error.ts";
import type { TeamConfig } from "../teams/team-config.ts";
import type { WorkflowConfig } from "../workflows/workflow-config.ts";
import { toPiSessionId } from "../utils/session-utils.ts";

export interface RunPaths {
	runId: string;
	stateRoot: string;
	artifactsRoot: string;
	manifestPath: string;
	tasksPath: string;
	eventsPath: string;
}

interface ManifestCacheEntry {
	manifest: TeamRunManifest;
	tasks: TeamTaskState[];
	manifestMtimeMs: number;
	manifestSize: number;
	tasksMtimeMs: number;
	tasksSize: number;
	cachedAt?: number;
}

const MANIFEST_CACHE_TTL_MS = 30 * 1000; // 30 seconds (FIX: reduced from 5 minutes for faster state updates)
const manifestCache = new Map<string, ManifestCacheEntry>();

function setManifestCache(stateRoot: string, entry: ManifestCacheEntry): void {
	if (manifestCache.has(stateRoot)) manifestCache.delete(stateRoot);
	entry.cachedAt = Date.now();
	// FIX: Evict all stale entries by TTL before adding new entry.
	// This ensures entries that are never accessed still get evicted
	// based on TTL, not just entries that are hit.
	const now = Date.now();
	for (const [key, val] of manifestCache.entries()) {
		if (val.cachedAt && now - val.cachedAt > MANIFEST_CACHE_TTL_MS) {
			manifestCache.delete(key);
		}
	}
	manifestCache.set(stateRoot, entry);
	while (manifestCache.size > DEFAULT_CACHE.manifestMaxEntries) {
		// FIX: Evict oldest entry by cachedAt (LRU), not insertion order.
		// cachedAt is set on both initial insertion and cache hits, so
		// frequently accessed entries bubble to the end and survive longer.
		let oldestKey: string | undefined;
		let oldestTime = Infinity;
		for (const [key, val] of manifestCache.entries()) {
			const t = val.cachedAt ?? 0;
			if (t < oldestTime) { oldestTime = t; oldestKey = key; }
		}
		if (!oldestKey) break;
		manifestCache.delete(oldestKey);
	}
}

function useProjectState(cwd: string): boolean {
	return findRepoRoot(cwd) !== undefined;
}

function invalidateRunCache(stateRoot: string): void {
	manifestCache.delete(stateRoot);
}

function scopeBaseRoot(cwd: string): string {
	return useProjectState(cwd) ? projectCrewRoot(cwd) : userCrewRoot();
}

function resolveRunStateRoot(cwd: string, runId: string): string | undefined {
	assertSafePathId("runId", runId);
	const runsRoot = path.join(scopeBaseRoot(cwd), DEFAULT_PATHS.state.runsSubdir);
	const scopedPath = resolveContainedRelativePath(runsRoot, runId, "runId");
	try {
		// Single atomic validation: resolves through symlinks via realpath,
		// verifies containment within runsRoot, and throws ENOENT if missing.
		// Eliminates the TOCTOU window from the previous existsSync + lstatSync
		// + resolveRealContainedPath sequence.
		resolveRealContainedPath(runsRoot, runId);
	} catch {
		return undefined;
	}
	return scopedPath;
}

function validateRunManifestPaths(cwd: string, runId: string, manifest: TeamRunManifest, stateRoot: string, tasksPath: string): boolean {
	if (manifest.runId !== runId || manifest.stateRoot !== stateRoot || manifest.tasksPath !== tasksPath || manifest.eventsPath !== path.join(stateRoot, "events.jsonl")) return false;
	const artifactsParent = path.join(scopeBaseRoot(cwd), DEFAULT_PATHS.state.artifactsSubdir);
	const expectedArtifactsRoot = resolveContainedRelativePath(artifactsParent, runId, "runId");
	if (manifest.artifactsRoot !== expectedArtifactsRoot) return false;
	if (fs.existsSync(expectedArtifactsRoot)) {
		try {
			if (fs.lstatSync(expectedArtifactsRoot).isSymbolicLink()) return false;
			resolveRealContainedPath(artifactsParent, runId);
		} catch {
			return false;
		}
	}
	return true;
}

export function createRunPaths(cwd: string, runId = createRunId()): RunPaths {
	assertSafePathId("runId", runId);
	const baseRoot = scopeBaseRoot(cwd);
	const stateRoot = resolveContainedRelativePath(path.join(baseRoot, DEFAULT_PATHS.state.runsSubdir), runId, "runId");
	const artifactsRoot = resolveContainedRelativePath(path.join(baseRoot, DEFAULT_PATHS.state.artifactsSubdir), runId, "runId");
	return {
		runId,
		stateRoot,
		artifactsRoot,
		manifestPath: path.join(stateRoot, DEFAULT_PATHS.state.manifestFile),
		tasksPath: path.join(stateRoot, DEFAULT_PATHS.state.tasksFile),
		eventsPath: path.join(stateRoot, DEFAULT_PATHS.state.eventsFile),
	};
}

export function createTasksFromWorkflow(runId: string, workflow: WorkflowConfig, team: TeamConfig, cwd: string): TeamTaskState[] {
	const stepToTaskId = new Map(workflow.steps.map((step, index) => [step.id, createTaskId(step.id, index)]));
	return workflow.steps.map((step, index) => {
		const role = team.roles.find((candidate) => candidate.name === step.role);
		const id = stepToTaskId.get(step.id) ?? createTaskId(step.id, index);
		const dependencies = step.dependsOn ?? [];
		const children = workflow.steps.filter((candidate) => candidate.dependsOn?.includes(step.id)).map((candidate) => stepToTaskId.get(candidate.id)).filter((childId): childId is string => childId !== undefined);
		return {
			id,
			runId,
			stepId: step.id,
			role: step.role,
			agent: role?.agent ?? step.role,
			title: step.id,
			status: "queued",
			dependsOn: dependencies,
			cwd,
			model: step.model,
			graph: {
				taskId: id,
				parentId: dependencies[0] ? stepToTaskId.get(dependencies[0]) : undefined,
				children,
				dependencies: dependencies.map((dep) => stepToTaskId.get(dep) ?? dep),
				queue: dependencies.length ? "blocked" : "ready",
			},
		};
	});
}

export function createRunManifest(params: {
	cwd: string;
	team: TeamConfig;
	workflow?: WorkflowConfig;
	goal: string;
	workspaceMode?: "single" | "worktree";
	ownerSessionId?: string;
}): { manifest: TeamRunManifest; tasks: TeamTaskState[]; paths: RunPaths } {
	const paths = createRunPaths(params.cwd);
	const now = new Date().toISOString();
	const tasks = params.workflow ? createTasksFromWorkflow(paths.runId, params.workflow, params.team, params.cwd) : [];
	const manifest: TeamRunManifest = {
		schemaVersion: 1,
		runId: paths.runId,
		sessionId: toPiSessionId(paths.runId),
		team: params.team.name,
		workflow: params.workflow?.name,
		goal: params.goal,
		status: "queued",
		workspaceMode: params.workspaceMode ?? params.team.workspaceMode ?? "single",
		createdAt: now,
		updatedAt: now,
		cwd: params.cwd,
		stateRoot: paths.stateRoot,
		artifactsRoot: paths.artifactsRoot,
		tasksPath: paths.tasksPath,
		eventsPath: paths.eventsPath,
		artifacts: [],
		...(params.ownerSessionId ? { ownerSessionId: params.ownerSessionId } : {}),
	};
	fs.mkdirSync(paths.stateRoot, { recursive: true });
	fs.mkdirSync(paths.artifactsRoot, { recursive: true });
	atomicWriteJson(paths.manifestPath, manifest);
	atomicWriteJson(paths.tasksPath, tasks);
	appendEvent(paths.eventsPath, {
		type: "run.created",
		runId: paths.runId,
		data: { team: params.team.name, workflow: params.workflow?.name },
		metadata: {
			seq: 1,
			provenance: "team_runner",
			sessionIdentity: { title: params.team.name, workspace: params.cwd, purpose: params.goal },
			ownership: { owner: params.team.name, workflowScope: params.workflow?.name ?? "manual", watcherAction: "act" },
			confidence: "high",
		},
	});
	invalidateRunCache(paths.stateRoot);
	return { manifest, tasks, paths };
}

export function saveRunManifest(manifest: TeamRunManifest): void {
	// FIX: Invalidate cache BEFORE atomic write to prevent stale cache serving
	// after a crash. If we invalidated after and crashed between write and
	// invalidation, the stale cache entry (up to MANIFEST_CACHE_TTL_MS old)
	// could be served by another process.
	invalidateRunCache(manifest.stateRoot);
	atomicWriteJson(path.join(manifest.stateRoot, "manifest.json"), manifest);
}

export async function saveRunManifestAsync(manifest: TeamRunManifest): Promise<void> {
	// FIX: Invalidate cache BEFORE atomic write to prevent stale cache serving
	// after a crash. See saveRunManifest for full explanation.
	invalidateRunCache(manifest.stateRoot);
	await atomicWriteJsonAsync(path.join(manifest.stateRoot, "manifest.json"), manifest);
}

export function saveRunTasks(manifest: TeamRunManifest, tasks: TeamTaskState[]): void {
	// FIX: Invalidate cache BEFORE atomic write to prevent stale cache serving.
	invalidateRunCache(manifest.stateRoot);
	atomicWriteJson(manifest.tasksPath, tasks);
}

/**
 * 2.1 caller-migration helper: coalesced variant. Use only when the
 * caller does NOT immediately read tasks.json afterwards (the read would
 * see the previous on-disk content while the write is still buffered).
 * Bulk update paths that fan out into multiple writer call sites are the
 * intended use case. Single-update + read-update loops (e.g.
 * persistSingleTaskUpdate) should keep using saveRunTasks.
 */
/** @internal */
function saveRunTasksCoalesced(manifest: TeamRunManifest, tasks: TeamTaskState[]): void {
	// FIX: Invalidate cache BEFORE atomic write to prevent stale cache serving.
	invalidateRunCache(manifest.stateRoot);
	atomicWriteJsonCoalesced(manifest.tasksPath, tasks);
}

export async function saveRunTasksAsync(manifest: TeamRunManifest, tasks: TeamTaskState[]): Promise<void> {
	// FIX: Invalidate cache BEFORE atomic write to prevent stale cache serving.
	invalidateRunCache(manifest.stateRoot);
	await atomicWriteJsonAsync(manifest.tasksPath, tasks);
}

/**
 * Save manifest and tasks files with individual atomic writes.
 * FIX: Changed from Promise.all (parallel, non-jointly-atomic) to sequential
 * writes to ensure manifest and tasks are always consistent. A crash between
 * writes now leaves them in a known state (manifest is the older copy, tasks
 * is newer) that stale-reconciler can repair.
 * FIX: Returns a result object so callers know which write step failed.
 * If manifest write succeeds but tasks write fails, the caller can recovery.
 */
/** @internal */
interface SaveManifestAndTasksResult {
	manifestWritten: boolean;
	tasksWritten: boolean;
	error?: string;
}

async function saveManifestAndTasksAtomic(manifest: TeamRunManifest, tasks: TeamTaskState[]): Promise<SaveManifestAndTasksResult> {
	let manifestWritten = false;
	let tasksWritten = false;
	try {
		await withRunLock(manifest, async () => {
			// FIX: Invalidate cache BEFORE writes to prevent stale cache serving.
			// Sequential writes instead of Promise.all to ensure manifest is
			// written before tasks. If a crash occurs between writes, manifest is
			// the older timestamp which stale-reconciler uses to detect inconsistency.
			invalidateRunCache(manifest.stateRoot);
			await atomicWriteJsonAsync(path.join(manifest.stateRoot, "manifest.json"), manifest);
			manifestWritten = true;
			await atomicWriteJsonAsync(manifest.tasksPath, tasks);
			tasksWritten = true;
		});
	} catch (err) {
		return {
			manifestWritten,
			tasksWritten,
			error: err instanceof Error ? err.message : String(err),
		};
	}
	return { manifestWritten: true, tasksWritten: true };
}

export interface UpdateRunStatusOptions {
	data?: Record<string, unknown>;
	metadata?: Parameters<typeof appendEvent>[1]["metadata"];
}

export function updateRunStatus(manifest: TeamRunManifest, status: TeamRunManifest["status"], summary?: string, options: UpdateRunStatusOptions = {}): TeamRunManifest {
	if (!canTransitionRunStatus(manifest.status, status)) {
		throw new Error(`Invalid run status transition: ${manifest.status} -> ${status}`);
	}
	const updated: TeamRunManifest = { ...manifest, status, updatedAt: new Date().toISOString(), summary: summary ?? manifest.summary };
	saveRunManifest(updated);
	// Unregister from active-run-index when run reaches a terminal status.
	// Without this, stale entries accumulate (e.g. integration tests in /tmp) and
	// Pi UI shows ghost "queued" runs that are actually completed/failed/cancelled.
	// Note: "blocked" is excluded because blocked runs can be unblocked later.
	if (status === "completed" || status === "failed" || status === "cancelled") {
		try { unregisterActiveRun(updated.runId); } catch { /* non-critical */ }
	}
	appendEvent(updated.eventsPath, {
		type: `run.${status}`,
		runId: updated.runId,
		message: summary,
		...(options.data ? { data: options.data } : {}),
		metadata: {
			provenance: "team_runner",
			sessionIdentity: { title: updated.team, workspace: updated.cwd, purpose: updated.goal },
			ownership: { owner: updated.team, workflowScope: updated.workflow ?? "manual", watcherAction: "act" },
			confidence: "high",
			...options.metadata,
		},
	});
	return updated;
}

export function __test__manifestCacheSize(): number {
	return manifestCache.size;
}

export function __test__clearManifestCache(): void {
	manifestCache.clear();
}

async function readJsonFileAsync<T>(filePath: string): Promise<T | undefined> {
	try {
		return JSON.parse(await fs.promises.readFile(filePath, "utf-8")) as T;
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code !== "ENOENT" && code !== "ENOTDIR") {
			logInternalError("readJsonFileAsync", err, `filePath=${filePath}`);
		}
		return undefined;
	}
}

export function loadRunManifestById(cwd: string, runId: string): { manifest: TeamRunManifest; tasks: TeamTaskState[] } | undefined {
	const stateRoot = resolveRunStateRoot(cwd, runId);
	if (!stateRoot) return undefined;
	const manifestPath = path.join(stateRoot, "manifest.json");
	const tasksPath = path.join(stateRoot, "tasks.json");

	let manifestStat: fs.Stats;
	try {
		manifestStat = fs.statSync(manifestPath);
	} catch {
		return undefined;
	}
	const cached = manifestCache.get(stateRoot);
	let tasksStat: fs.Stats | undefined;
	try {
		tasksStat = fs.statSync(tasksPath);
	} catch {
		tasksStat = undefined;
	}
	const tasksMtimeMs = tasksStat?.mtimeMs ?? 0;
	if (
		cached
		&& cached.manifestMtimeMs === manifestStat.mtimeMs
		&& cached.manifestSize === manifestStat.size
		&& cached.tasksMtimeMs === tasksMtimeMs
		&& cached.tasksSize === (tasksStat?.size ?? 0)
	) {
		// TTL eviction: expire stale entries even if mtime matches
		if (cached.cachedAt && Date.now() - cached.cachedAt > MANIFEST_CACHE_TTL_MS) {
			manifestCache.delete(stateRoot);
		} else if (!validateRunManifestPaths(cwd, runId, cached.manifest, stateRoot, tasksPath)) {
			manifestCache.delete(stateRoot);
			return undefined;
		} else {
			return { manifest: cached.manifest, tasks: cached.tasks };
		}
	}

	// FIX: Sentinel-based retry loop for best-effort consistency. Re-stat and
	// re-read until mtime/size are stable. The 3-attempt limit is arbitrary —
	// high contention can cause non-convergence. IMPORTANT: This loop does NOT
	// guarantee consistency under contention because the final stat and final
	// read are not atomic. A concurrent writer can complete a full write cycle
	// between the final stat and the read, making the cached mtime/size stale.
	// For strict consistency, callers MUST wrap load+modify+save in
	// withRunLock(). This loop is best-effort only for benign race conditions.
	let attempts = 0;
	let manifest: TeamRunManifest | undefined;
	let tasks: TeamTaskState[] | undefined;
	while (attempts < 3) {
		const freshStat = fs.statSync(manifestPath);
		manifest = readJsonFile<TeamRunManifest>(manifestPath);
		const freshTasksStat = fs.existsSync(tasksPath) ? fs.statSync(tasksPath) : undefined;
		tasks = readJsonFile<TeamTaskState[]>(tasksPath) ?? [];
		// If size/mtime didn't change between stat and read, we're consistent.
		if (freshStat.mtimeMs === manifestStat.mtimeMs && freshStat.size === manifestStat.size
			&& (!freshTasksStat || (freshTasksStat.mtimeMs === tasksStat?.mtimeMs && freshTasksStat.size === tasksStat?.size))) {
			break;
		}
		attempts += 1;
		manifestStat = freshStat;
		tasksStat = freshTasksStat;
	}
	if (!manifest || !validateRunManifestPaths(cwd, runId, manifest, stateRoot, tasksPath)) return undefined;
	setManifestCache(stateRoot, {
		manifest,
		tasks: tasks ?? [],
		manifestMtimeMs: manifestStat.mtimeMs,
		manifestSize: manifestStat.size,
		tasksMtimeMs,
		tasksSize: tasksStat?.size ?? 0,
	});
	return { manifest, tasks: tasks ?? [] };
}

export async function loadRunManifestByIdAsync(cwd: string, runId: string): Promise<{ manifest: TeamRunManifest; tasks: TeamTaskState[] } | undefined> {
	const stateRoot = resolveRunStateRoot(cwd, runId);
	if (!stateRoot) return undefined;
	const manifestPath = path.join(stateRoot, "manifest.json");
	const tasksPath = path.join(stateRoot, "tasks.json");

	let manifestStat: fs.Stats;
	try {
		manifestStat = await fs.promises.stat(manifestPath);
	} catch {
		return undefined;
	}
	const cached = manifestCache.get(stateRoot);
	let tasksStat: fs.Stats | undefined;
	try {
		tasksStat = await fs.promises.stat(tasksPath);
	} catch {
		tasksStat = undefined;
	}
	const tasksMtimeMs = tasksStat?.mtimeMs ?? 0;
	if (cached && cached.manifestMtimeMs === manifestStat.mtimeMs && cached.manifestSize === manifestStat.size && cached.tasksMtimeMs === tasksMtimeMs && cached.tasksSize === (tasksStat?.size ?? 0)) {
		// TTL eviction: expire stale entries even if mtime matches
		if (cached.cachedAt && Date.now() - cached.cachedAt > MANIFEST_CACHE_TTL_MS) {
			manifestCache.delete(stateRoot);
		} else if (!validateRunManifestPaths(cwd, runId, cached.manifest, stateRoot, tasksPath)) {
			manifestCache.delete(stateRoot);
			return undefined;
		} else {
			return { manifest: cached.manifest, tasks: cached.tasks };
		}
	}

	// FIX: Sentinel-based retry loop to close TOCTOU window between stat and read.
	// Matches the pattern used in the sync loadRunManifestById.
	let manifest: TeamRunManifest | undefined;
	let tasks: TeamTaskState[] | undefined;
	let attempts = 0;
	while (attempts < 3) {
		const freshStat = await fs.promises.stat(manifestPath);
		manifest = await readJsonFileAsync<TeamRunManifest>(manifestPath);
		const freshTasksStat = await fs.promises.stat(tasksPath).catch(() => undefined);
		tasks = (await readJsonFileAsync<TeamTaskState[]>(tasksPath)) ?? [];
		// If size/mtime didn't change between stat and read, we're consistent.
		if (freshStat.mtimeMs === manifestStat.mtimeMs && freshStat.size === manifestStat.size
			&& (!freshTasksStat || (freshTasksStat.mtimeMs === tasksStat?.mtimeMs && freshTasksStat.size === tasksStat?.size))) {
			break;
		}
		attempts += 1;
		manifestStat = freshStat;
		tasksStat = freshTasksStat;
	}

	if (!manifest || !validateRunManifestPaths(cwd, runId, manifest, stateRoot, tasksPath)) return undefined;
	setManifestCache(stateRoot, { manifest, tasks: tasks ?? [], manifestMtimeMs: manifestStat.mtimeMs, manifestSize: manifestStat.size, tasksMtimeMs, tasksSize: tasksStat?.size ?? 0 });
	return { manifest, tasks: tasks ?? [] };
}
