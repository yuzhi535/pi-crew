/**
 * RunWatcherRegistry — bounded per-run filesystem watcher registry.
 *
 * PROBLEM (pts/2 interactive-session hang, /home/bom/pts2-hang-investigation-2026-06-16.md):
 * `watchCrewState` used `fs.watch(<crewRoot>/state, { recursive: true })`. On
 * Linux, Node implements "recursive" by creating ONE inotify watch PER
 * SUBDIRECTORY. With many historical runs under `.crew/state/runs/`, this
 * ballooned to hundreds of watches (109→339 observed) — one per run dir ever —
 * and the resulting event volume + render amplification produced a permanent
 * busy-loop (71% CPU, 400KB/s read) even with no active work.
 *
 * FIX: instead of recursively watching the whole history, watch a SINGLE
 * non-recursive watcher on the `runs/` root (to detect new run dirs appearing)
 * PLUS one non-recursive watcher PER ACTIVE RUN. Total inotify cost is now
 * O(active runs) — typically 1–5 — not O(total history). Completed runs stop
 * being watched as soon as they leave the active set (reconciled by buildFrame,
 * which reads manifest statuses each preload tick).
 *
 * The registry is intentionally small and directly unit-testable (a Map of
 * watchers with add/remove/reconcile/close semantics).
 */
import type { FSWatcher } from "node:fs";
import { closeWatcher, watchWithErrorHandler } from "./fs-watch.ts";

export interface ReconcileResult {
	added: string[];
	removed: string[];
}

export interface ActiveRun {
	runId: string;
	runDir: string;
}

export type RunChangeCallback = (runId: string) => void;
export type ErrorCallback = (error: unknown) => void;

export class RunWatcherRegistry {
	private readonly runWatchers = new Map<string, FSWatcher>();
	private rootWatcher: FSWatcher | undefined;
	private closed = false;

	/**
	 * Watch the `runs/` root directory (non-recursive) and invoke `onNewRun`
	 * whenever a new run subdirectory appears. This is the only way to detect a
	 * brand-new run, because `crew.run.created` is never emitted by the runtime
	 * (confirmed: only `crew.run.completed/failed/cancelled` are emitted).
	 */
	setRootWatcher(
		runsDir: string,
		onNewRun: RunChangeCallback,
		onError?: ErrorCallback,
	): void {
		if (this.closed) return;
		// Replace any prior root watcher.
		closeWatcher(this.rootWatcher);
		this.rootWatcher = watchWithErrorHandler(
			runsDir,
			(_eventType, filename) => {
				if (typeof filename !== "string" || filename.length === 0) return;
				// fs.watch reports directory entries as bare names (no slash on Linux).
				// A new run dir appears as `runs/<runId>` → filename = "<runId>".
				// Filter obviously-not-run-id noise (files, temp, etc.) defensively.
				const candidate = filename.replace(/\\/g, "/").split("/")[0];
				if (candidate.length === 0) return;
				onNewRun(candidate);
			},
			(error) => {
				if (onError) onError(error);
			},
		) ?? undefined;
	}

	/**
	 * Add a NON-RECURSIVE watcher on a single run directory. Costs exactly ONE
	 * inotify watch. If a watcher for this runId already exists, close + replace.
	 * Returns true if a watcher is now active for this runId.
	 */
	addRunWatcher(
		runId: string,
		runDir: string,
		onChange: RunChangeCallback,
		onError?: ErrorCallback,
	): boolean {
		if (this.closed) return false;
		const existing = this.runWatchers.get(runId);
		if (existing) closeWatcher(existing);
		const watcher = watchWithErrorHandler(
			runDir,
			() => onChange(runId),
			(error) => {
				if (onError) onError(error);
			},
		);
		if (watcher) {
			this.runWatchers.set(runId, watcher);
			return true;
		}
		// watchWithErrorHandler returned null (fs.watch unsupported / dir missing).
		// Remove any stale entry so hasWatcher() stays honest.
		this.runWatchers.delete(runId);
		return false;
	}

	/** Remove and close a specific run's watcher. No-op if not watched. */
	removeRunWatcher(runId: string): void {
		const watcher = this.runWatchers.get(runId);
		if (watcher) {
			closeWatcher(watcher);
			this.runWatchers.delete(runId);
		}
	}

	/** Is a run currently being watched? */
	hasWatcher(runId: string): boolean {
		return this.runWatchers.has(runId);
	}

	/**
	 * Reconcile against the current active-run set: add watchers for active runs
	 * not yet watched, remove watchers for runs that left the active set. Returns
	 * which runIds were added / removed (useful for logging + tests).
	 */
	reconcile(
		activeRuns: ActiveRun[],
		onChange: RunChangeCallback,
		onError?: ErrorCallback,
	): ReconcileResult {
		if (this.closed) return { added: [], removed: [] };
		const activeIds = new Set(activeRuns.map((r) => r.runId));
		const added: string[] = [];
		const removed: string[] = [];
		// Remove watchers for runs no longer active.
		for (const runId of [...this.runWatchers.keys()]) {
			if (!activeIds.has(runId)) {
				this.removeRunWatcher(runId);
				removed.push(runId);
			}
		}
		// Add watchers for newly-active runs.
		for (const { runId, runDir } of activeRuns) {
			if (!this.runWatchers.has(runId)) {
				if (this.addRunWatcher(runId, runDir, onChange, onError)) {
					added.push(runId);
				}
			}
		}
		return { added, removed };
	}

	/** Close ALL watchers (per-run + root). Safe to call multiple times. */
	closeAll(): void {
		this.closed = true;
		for (const watcher of this.runWatchers.values()) closeWatcher(watcher);
		this.runWatchers.clear();
		closeWatcher(this.rootWatcher);
		this.rootWatcher = undefined;
	}

	/** Number of active PER-RUN watchers (excludes the root watcher). */
	get size(): number {
		return this.runWatchers.size;
	}
}
