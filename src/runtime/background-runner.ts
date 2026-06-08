import * as fs from "node:fs";
import * as path from "node:path";
import { allAgents, discoverAgents } from "../agents/discover-agents.ts";
import { loadConfig } from "../config/config.ts";
import { appendEvent } from "../state/event-log.ts";
import {
	loadRunManifestById,
	saveRunManifest,
	updateRunStatus,
} from "../state/state-store.ts";
import { allTeams, discoverTeams } from "../teams/discover-teams.ts";
import { projectCrewRoot } from "../utils/paths.ts";
import {
	allWorkflows,
	discoverWorkflows,
} from "../workflows/discover-workflows.ts";
// Heavy runtime — lazy-loaded to avoid pulling team-runner into background-runner
// at module load time. Only needed when a background run actually starts.
import type { executeTeamRun as ExecuteTeamRunFn } from "./team-runner.ts";

let _cachedExecuteTeamRun: typeof ExecuteTeamRunFn | undefined;
async function executeTeamRun(
	...args: Parameters<typeof ExecuteTeamRunFn>
): Promise<Awaited<ReturnType<typeof ExecuteTeamRunFn>>> {
	if (!_cachedExecuteTeamRun) {
		// LAZY: avoid pulling team-runner into background-runner at module load time.
		const mod = await import("./team-runner.ts");
		_cachedExecuteTeamRun = mod.executeTeamRun;
	}
	return _cachedExecuteTeamRun(...args);
}

import { logInternalError } from "../utils/internal-error.ts";
import { writeAsyncStartMarker } from "./async-marker.ts";
import { terminateActiveChildPiProcesses } from "./child-pi.ts";
import { unregisterWorker } from "./orphan-worker-registry.ts";
import { directTeamAndWorkflowFromRun } from "./direct-run.ts";
import { expandParallelResearchWorkflow } from "./parallel-research.ts";
import { startParentGuard, stopParentGuard } from "./parent-guard.ts";
import {
	resolveCrewRuntime,
	runtimeResolutionState,
} from "./runtime-resolver.ts";

/**
 * Heartbeat mechanism: periodically write a heartbeat file so the stale reconciler
 * can distinguish "process died" from "process still alive but quiet".
 * Without this, the reconciler relies solely on process.kill(pid, 0) which can
 * false-positive when a process is SIGKILLed and the PID hasn't been recycled yet.
 */
function startHeartbeat(
	stateRoot: string,
	eventsPath: string,
	runId: string,
): () => void {
	const heartbeatPath = path.join(stateRoot, "heartbeat.json");
	const writeHeartbeat = (): void => {
		try {
			const mem = process.memoryUsage();
			fs.writeFileSync(
				heartbeatPath,
				JSON.stringify({
					pid: process.pid,
					at: Date.now(),
					runId,
					memory: {
						heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
						rssMb: Math.round(mem.rss / 1024 / 1024),
					},
				}),
				"utf-8",
			);
		} catch {
			/* ignore — best-effort */
		}
	};
	// Write immediately so the stale reconciler can use heartbeat age as liveness evidence.
	writeHeartbeat();
	const interval = setInterval(writeHeartbeat, 15_000);
	interval.unref();
	return () => clearInterval(interval);
}

/**
 * Remove macOS malloc-stack-logging vars that get inherited by child shells.
 * Without this, every subprocess prints "MallocStackLogging: can't turn off..." to stderr.
 */
function scrubProcessEnv(): void {
	delete process.env.MallocStackLogging;
	delete process.env.MallocStackLoggingNoCompact;
}

function argValue(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	if (index === -1) return undefined;
	return process.argv[index + 1];
}

function startInterruptGuard(
	manifest: { runId: string; stateRoot: string; eventsPath: string },
	abortController: AbortController,
): () => void {
	const controlPath = path.join(
		manifest.stateRoot,
		"foreground-control.json",
	);
	// FIX: Made configurable via PI_CREW_INTERRUPT_GUARD_INTERVAL_MS env var.
	// Default 250ms balances fast SIGINT response against filesystem overhead.
	const interruptGuardInterval =
		Number(process.env.PI_CREW_INTERRUPT_GUARD_INTERVAL_MS) || 250;
	const interval = setInterval(() => {
		try {
			if (!fs.existsSync(controlPath)) return;
			const parsed = JSON.parse(
				fs.readFileSync(controlPath, "utf-8"),
			) as { requests?: Array<{ type: string; acknowledged?: boolean }> };
			const last = parsed.requests?.at(-1);
			if (last?.type === "interrupt" && last?.acknowledged !== true) {
				appendEvent(manifest.eventsPath, {
					type: "async.interrupt_detected",
					runId: manifest.runId,
					message:
						"Background runner detected foreground interrupt — killing child processes and exiting.",
				});
				// FIX: Terminate ALL child-pi processes IMMEDIATELY before exiting.
				// Previously this was missing, causing orphaned child processes to run forever
				// after the background-runner exited. terminateActiveChildPiProcesses sends
				// SIGTERM then SIGKILL (after HARD_KILL_MS=3s) to every active child.
				const killed = terminateActiveChildPiProcesses();
				console.log(
					`[background-runner] interrupt: killed ${killed} child processes`,
				);
				// Also abort the run signal so executeTeamRun exits quickly via its signal check.
				abortController.abort();
				// NOTE: process.exit() schedules exit handlers synchronously. The finally
				// block in main() (stopParentGuard, cleanup, etc.) executes BEFORE the
				// process actually terminates. This ordering is intentional — cleanup must
				// run before exit handlers to ensure consistent state.
				process.exit(130);
			}
		} catch {
			/* ignore read/parse errors */
		}
	}, interruptGuardInterval);
	interval.unref();
	return () => clearInterval(interval);
}

/**
 * CRITICAL: Node.js v24 throws on unhandled rejections by default.
 * Without this handler, any unhandled promise rejection (e.g., from cleanupTempDir,
 * terminateLiveAgentsForRun, or other async cleanup) will crash the background runner
 * BEFORE async.completed is written to the event log.
 * This causes the async notifier to falsely detect a stuck run after quietMs expires.
 */
function setupUnhandledRejectionGuard(
	state: {
		cwd?: string;
		runId?: string;
		eventsPath?: string;
	},
	abortController: AbortController,
	setExitFlag: () => void,
): void {
	process.on("unhandledRejection", (reason, promise) => {
		const message =
			reason instanceof Error ? reason.message : String(reason);
		console.error("[background-runner] UNHANDLED REJECTION:", reason);
		console.error(
			"[background-runner] Stack:",
			reason instanceof Error ? reason.stack : "N/A",
		);
		try {
			if (state.eventsPath && state.runId) {
				appendEvent(state.eventsPath, {
					type: "async.failed",
					runId: state.runId,
					message: `Unhandled rejection: ${message}`,
					data: {
						reason: String(reason),
						stack:
							reason instanceof Error ? reason.stack : undefined,
						handled: false,
					},
				});
			}
		} catch (appendErr) {
			console.error(
				"[background-runner] Failed to write async.failed event:",
				appendErr,
			);
		}
		// FIX Issues #2& #4: Signal child processes to terminate via abortController,
		// set the exit flag so main() exits after the finally block runs cleanup.
		// Previously this called process.exit(1) directly, bypassing the finally block
		// and leaving child processes orphaned.
		abortController.abort();
		setExitFlag();
	});
}

/**
 * FIX Issue #4: Shared cleanup function called by both the finally block
 * and error handlers. This ensures consistent cleanup regardless of how
 * the process exits (normal flow, unhandled rejection, or main() exception).
 */
function runCleanup(
	stopInterruptGuard: () => void,
	stopParentGuard: () => void,
	stopHeartbeat: () => void,
	keepAlive: NodeJS.Timeout,
	exitDueToRejection: boolean,
): void {
	console.log(
		`[background-runner] DEBUG: runCleanup, exitDueToRejection=${exitDueToRejection}`,
	);
	stopInterruptGuard();
	stopParentGuard();
	stopHeartbeat();
	// FIX: clearInterval FIRST, then kill children. This ensures the heartbeat
	// interval is always cleaned up even if terminateActiveChildPiProcesses throws.
	clearInterval(keepAlive);
	// FIX Issues #1, #2, #4: Wrap child process termination in try/catch so errors
	// don't prevent the cleanup from completing. We log but don't re-throw since
	// we're already exiting.
	let killed = 0;
	try {
		killed = terminateActiveChildPiProcesses();
	} catch (error) {
		console.log(
			`[background-runner] runCleanup: terminateActiveChildPiProcesses error: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	console.log(`[background-runner] runCleanup: killed ${killed} child processes`);
	// FIX Issue #5: Unregister this worker from the orphan registry on exit.
	// Previously this was only cleaned up on the next session_start cleanup cycle,
	// causing unnecessary delay in removing stale registrations.
	try {
		unregisterWorker(process.pid);
	} catch (error) {
		console.log(
			`[background-runner] runCleanup: unregisterWorker error: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	// FIX Issues #2 & #4: If an unhandled rejection occurred, exit with code 1
	// after cleanup completes. This ensures the finally block runs cleanup first,
	// then we exit with the appropriate code.
	if (exitDueToRejection) {
		process.exit(1);
	}
}

async function main(): Promise<void> {
	// FIX: Store logFd so it can be closed on exit to prevent file descriptor leak
	let logFd: number | undefined;
	// Redirect console to background.log since stdio is "ignore" in detached mode.
	// Must be BEFORE any console.log/console.error calls.
	const _cwd = argValue("--cwd");
	const _runId = argValue("--run-id");
	if (_cwd && _runId) {
		try {
			// Use projectCrewRoot() so the background log lives next to the
			// manifest in either .crew/state/runs/ or .pi/teams/state/runs/
			// depending on the project's chosen layout (issue #29).
			const logPath = path.join(
				projectCrewRoot(_cwd),
				"state",
				"runs",
				_runId,
				"background.log",
			);
			logFd = fs.openSync(logPath, "a");
			const origWrite =
				(_prefix: string) =>
				(data: unknown, ...args: unknown[]) => {
					const msg = [data, ...args].map(String).join(" ") + "\n";
					fs.writeSync(logFd!, msg);
				};
			console.log = origWrite("OUT");
			console.error = origWrite("ERR");
			// FIX: Close logFd on process exit to prevent file descriptor leak
			process.on("exit", () => {
				try {
					if (logFd !== undefined) fs.closeSync(logFd);
				} catch {
					/* ignore */
				}
			});
		} catch {
			/* best-effort */
		}
	}

	// Scrub macOS malloc vars BEFORE anything else — must be clean for all child processes
	scrubProcessEnv();
	// Install signal handlers EARLY — log events before exiting so we can distinguish
	// OOM/SIGKILL (no event) from SIGTERM/SIGINT (event written).
	const signalLog = (sig: string, eventsPath: string): void => {
		const runId = argValue("--run-id");
		if (runId && eventsPath) {
			appendEvent(eventsPath, {
				type: "async.failed",
				runId,
				message: `Background runner received ${sig} — exiting.`,
				data: { signal: sig, pid: process.pid },
			});
		}
	};
	// BUG #17 FIX: Compute exitCodePath at module load time using args,
	// NOT by referencing `manifest` (declared inside main() and not in scope at module load).
	const exitCodePath = ((): string | undefined => {
		const cwd = argValue("--cwd");
		const runId = argValue("--run-id");
		if (!cwd || !runId) return undefined;
		// Use projectCrewRoot() to honour the .pi/teams/ fallback (issue #29).
		return path.join(
			projectCrewRoot(cwd),
			"state",
			"runs",
			runId,
			"exit-code.txt",
		);
	})();
	if (exitCodePath) {
		process.on("exit", (code) => {
			try {
				fs.appendFileSync(
					exitCodePath,
					`${new Date().toISOString()} exit_code=${code} pid=${process.pid}\n`,
				);
			} catch {}
		});
	}

	// FIX Issue #1: Load manifest and create abortController BEFORE signal handlers
	// are installed, since the handlers reference manifest.eventsPath and abortController.
	const cwd = argValue("--cwd");
	const runId = argValue("--run-id");
	if (!cwd || !runId)
		throw new Error(
			"Usage: background-runner.ts --cwd <cwd> --run-id <runId>",
		);
	const loaded = loadRunManifestById(cwd, runId); // NOTE: no withRunLock - best-effort only; concurrent writes may cause inconsistency;
	if (!loaded) throw new Error(`Run '${runId}' not found.`);
	let { manifest, tasks } = loaded;
	const abortController = new AbortController();

	process.on("SIGTERM", () => {
		// BUG #17 FIX: Handle SIGTERM for graceful shutdown. Real I/O (appendEvent) flushes io_uring state before abort to prevent corruption..
		// IMPORTANT: Perform real I/O here to flush io_uring state after EINTR.
		// Without I/O, io_uring can enter corrupted state and cause silent crash.
		// FIX Issue #3: Trigger graceful shutdown via abortController signal,
		// allowing the finally block to run and clean up child processes.
		// The io_uring I/O is still performed before abort takes effect.
		const runId = argValue("--run-id");
		if (runId && manifest.eventsPath) {
			try {
				appendEvent(manifest.eventsPath, {
					type: "async.sigterm_received_graceful_shutdown",
					runId,
					message: `SIGTERM received, graceful shutdown via abort pid=${process.pid}`,
					data: { pid: process.pid, ppid: process.ppid },
				});
			} catch {
				/* best-effort */
			}
		}
		// Trigger graceful shutdown via abort signal so finally block runs
		abortController.abort();
	});
	process.on("SIGINT", () => {
		signalLog("SIGINT", manifest.eventsPath);
		process.exit(130);
	});
	// BUG #17: Catch ALL signals to identify what kills the background runner
	for (const sig of [
		"SIGHUP",
		"SIGUSR1",
		"SIGUSR2",
		"SIGPIPE",
		"SIGALRM",
		"SIGPROF",
		"SIGIO",
		"SIGPWR",
		"SIGSYS",
		"SIGURG",
		"SIGWINCH",
		"SIGCONT",
		"SIGTSTP",
		"SIGTTIN",
		"SIGTTOU",
		"SIGVTALRM",
		"SIGXCPU",
		"SIGXFSZ",
	] as const) {
		try {
			process.on(sig, () => {
				signalLog(sig, manifest.eventsPath);
			});
		} catch {
			/* some signals not supported on this platform */
		}
	}
	// Hook Node.js abort — if process.exit is called with code 1 (uncaught exception, assert failure)
	// we log it before exiting so it appears in background.log
	const origExit = process.exit.bind(process);
	// Intercept all exit(code) calls to log them as async.exit events before exiting.
	// This surfaces uncaught exceptions / early exits that would otherwise vanish silently.
	process.exit = ((code?: number | string): never => {
		const runId2 = argValue("--run-id");
		const codeStr = code === undefined ? "<none>" : String(code);
		if (runId2 && manifest.eventsPath) {
			try {
				appendEvent(manifest.eventsPath, {
					type: "async.exit",
					runId: runId2,
					message: `Background runner exit(${codeStr}) pid=${process.pid}`,
					data: { code, pid: process.pid },
				});
			} catch {
				/* best-effort */
			}
		}
		return origExit(code);
	}) as typeof process.exit;

	// Setup unhandled rejection guard FIRST — must be before any async operations
	// that might produce unhandled rejections during cleanup. Without this, any unhandled
	// rejection would crash the worker BEFORE async.failed events are written.
	const rejectionGuardState = {
		cwd,
		runId,
		eventsPath: manifest.eventsPath,
	};
	// FIX Issues #2& #4: Flag to signal that an unhandled rejection occurred.
	// When set, runCleanup() will ensure process.exit(1) is called after cleanup.
	let exitDueToRejection = false;
	const setExitFlag = (): void => {
		exitDueToRejection = true;
	};
	setupUnhandledRejectionGuard(rejectionGuardState, abortController, setExitFlag);

	// Start parent guard — if parent is already dead, exit immediately
	const parentPid = Number(process.env.PI_CREW_PARENT_PID);
	if (parentPid > 0) startParentGuard(parentPid);
	// NOTE: intentionally no unref() — the guard keeps the event loop alive
	// to prevent premature worker exit. See parent-guard.ts:86 for rationale.

	appendEvent(manifest.eventsPath, {
		type: "async.started",
		runId: manifest.runId,
		data: { pid: process.pid },
	});
	console.log(
		`[background-runner] DEBUG: async.started written, pid=${process.pid}`,
	);
	writeAsyncStartMarker(manifest, {
		pid: process.pid,
		startedAt: new Date().toISOString(),
	});
	const stopHeartbeat = startHeartbeat(
		manifest.stateRoot,
		manifest.eventsPath,
		manifest.runId,
	);
	const stopInterruptGuard = startInterruptGuard(manifest, abortController);
	console.log(`[background-runner] DEBUG: heartbeat+interrupt guard started`);
	// NOTE: Keep-alive interval is NOT unref'd (unlike heartbeat and interrupt
	// guard intervals which ARE unref'd). This is intentional — during jiti
	// compilation of team-runner.ts, the event loop must not drain prematurely.
	// The interval is always cleared in the finally block, so the delay is
	// bounded by the 5s interval. The event loop exit is deferred at most 5s.
	const keepAlive = setInterval(() => {}, 5000);

	try {
		console.log(`[background-runner] DEBUG: about to call discoverAgents`);
		const agents = allAgents(discoverAgents(cwd));
		console.log(
			`[background-runner] DEBUG: discoverAgents done, ${agents.length} agents`,
		);
		fs.fsyncSync(fs.openSync(manifest.eventsPath, "a")); // FORCE flush so we see this before death
		console.log(
			`[background-runner] DEBUG: calling directTeamAndWorkflowFromRun`,
		);
		const direct = directTeamAndWorkflowFromRun(manifest, tasks, agents);
		console.log(`[background-runner] DEBUG: direct done, finding team`);
		const team =
			direct?.team ??
			allTeams(discoverTeams(cwd)).find(
				(candidate) => candidate.name === manifest.team,
			);
		if (!team) throw new Error(`Team '${manifest.team}' not found.`);
		console.log(
			`[background-runner] DEBUG: team=${team.name}, finding workflow`,
		);
		const baseWorkflow =
			direct?.workflow ??
			allWorkflows(discoverWorkflows(cwd)).find(
				(candidate) => candidate.name === manifest.workflow,
			);
		if (!baseWorkflow)
			throw new Error(`Workflow '${manifest.workflow ?? ""}' not found.`);
		console.log(`[background-runner] DEBUG: workflow=${baseWorkflow.name}`);
		const workflow = expandParallelResearchWorkflow(baseWorkflow, cwd);
		console.log(`[background-runner] DEBUG: loading config`);
		const loadedConfig = loadConfig(cwd);
		const runConfig =
			manifest.runConfig &&
			typeof manifest.runConfig === "object" &&
			!Array.isArray(manifest.runConfig)
				? (manifest.runConfig as typeof loadedConfig.config)
				: loadedConfig.config;
		const runtime = manifest.runtimeResolution
			? {
					kind: manifest.runtimeResolution.kind,
					requestedMode: manifest.runtimeResolution.requestedMode,
					available: manifest.runtimeResolution.available,
					fallback: manifest.runtimeResolution.fallback,
					steer: manifest.runtimeResolution.kind === "live-session",
					resume: manifest.runtimeResolution.kind === "live-session",
					liveToolActivity:
						manifest.runtimeResolution.kind === "live-session",
					transcript: manifest.runtimeResolution.kind !== "scaffold",
					reason: manifest.runtimeResolution.reason,
					safety: manifest.runtimeResolution.safety,
				}
			: await resolveCrewRuntime(runConfig);
		const runtimeResolution =
			manifest.runtimeResolution ?? runtimeResolutionState(runtime);
		manifest = {
			...manifest,
			runtimeResolution,
			runConfig,
			updatedAt: new Date().toISOString(),
		};
		saveRunManifest(manifest);
		appendEvent(manifest.eventsPath, {
			type: "runtime.resolved",
			runId: manifest.runId,
			message: `Runtime resolved: ${runtime.kind} safety=${runtime.safety}`,
			data: { runtimeResolution, async: true },
		});
		if (runtime.safety === "blocked")
			throw new Error(
				runtime.reason ??
					"Child worker execution is disabled; refusing to create no-op scaffold subagents.",
			);
		const executeWorkers = runtime.kind !== "scaffold";
		// Use ownerSessionId for workspaceId to ensure agents are only visible to the session that spawned them.
		// manifest.cwd would cause cross-session visibility since all sessions share the same project directory.
		// Mark this as background mode so task-runner writes events to background.log for debugging.
		process.env.PI_CREW_BACKGROUND_MODE = "1";
		// BUG #17: Keep-alive interval (NOT unref'd) prevents event loop from exiting
		// during jiti compilation of team-runner.ts. Without this, the event loop
		// can drain when import() blocks, causing the process to exit prematurely.
		// NOTE: abortController is already created above (before heartbeat/interrupt guard start)
		// so it is available here and its signal is passed through to executeTeamRun → child-pi.

		console.log(`[background-runner] DEBUG: calling executeTeamRun`);
		let result;
		try {
			result = await executeTeamRun({
				manifest,
				tasks,
				team,
				workflow,
				agents,
				executeWorkers,
				limits: runConfig.limits,
				runtime,
				runtimeConfig: runConfig.runtime,
				skillOverride: manifest.skillOverride,
				reliability: runConfig.reliability,
				workspaceId: manifest.ownerSessionId ?? manifest.cwd,
				signal: abortController.signal,
			});
			console.log(
				`[background-runner] DEBUG: executeTeamRun returned, status=${result.manifest.status}`,
			);
		} catch (execError) {
			console.log(
				`[background-runner] DEBUG: executeTeamRun THREW: ${execError instanceof Error ? execError.message : String(execError)}`,
			);
			console.log(
				`[background-runner] DEBUG: stack: ${execError instanceof Error ? execError.stack : "N/A"}`,
			);
			throw execError;
		}
		manifest = result.manifest;
		tasks = result.tasks;
		appendEvent(manifest.eventsPath, {
			type: "async.completed",
			runId: manifest.runId,
			data: { status: manifest.status, tasks: tasks.length },
		});
		console.log(
			`[background-runner] DEBUG: async.completed written, status=${manifest.status}`,
		);
		if (
			manifest.status === "failed" ||
			manifest.status === "cancelled" ||
			manifest.status === "blocked"
		)
			process.exitCode = 1;
	} catch (error) {
		// Terminate live agents on failure too — agents are done when the run fails
		try {
			const loaded = loadRunManifestById(cwd, runId); // NOTE: no withRunLock - best-effort only; concurrent writes may cause inconsistency;
			if (loaded) {
				// LAZY: live-agent-manager only needed on failure cleanup path; avoid module load at hot path.
				const { terminateLiveAgentsForRun } = await import(
					"./live-agent-manager.ts"
				);
				void terminateLiveAgentsForRun(
					loaded.manifest.runId,
					"failed",
					appendEvent,
					loaded.manifest.eventsPath,
				).catch((error) =>
					logInternalError(
						"background-runner.terminate",
						error,
						`runId=${loaded.manifest.runId}`,
					),
				);
			}
		} catch {
			/* best-effort */
		}
		const message = error instanceof Error ? error.message : String(error);
		manifest = updateRunStatus(manifest, "failed", message);
		appendEvent(manifest.eventsPath, {
			type: "async.failed",
			runId: manifest.runId,
			message,
		});
		process.exitCode = 1;
		console.log(
			`[background-runner] DEBUG: catch block, error=${error instanceof Error ? error.message : String(error)}`,
		);
	} finally {
		// FIX Issue #4: Use shared runCleanup() function for consistent cleanup
		// across all exit paths (normal, unhandled rejection, main() exception).
		runCleanup(
			stopInterruptGuard,
			stopParentGuard,
			stopHeartbeat,
			keepAlive,
			exitDueToRejection,
		);
	}
}

await main().catch((err) => {
	console.error(
		`[background-runner] DEBUG: main() uncaught: ${err?.message ?? err}`,
	);
	process.exit(1);
});
