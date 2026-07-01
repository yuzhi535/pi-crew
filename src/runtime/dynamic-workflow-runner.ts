/**
 * dynamic-workflow-runner.ts — Script-driven workflow runtime (P2).
 *
 * Spec: research-findings/goal-workflow/00-SPEC.md §3.3
 * Plan: 07-PLAN.md v3 P2 + §0c C5 (resolveRealContainedPath).
 *
 * Loads a `.dwf.ts` script's default export, transpiles it via jiti (the existing
 * TS loader used by async-runner.ts), and executes it with a FROZEN WorkflowCtx.
 *
 * HONEST v1 TRUST MODEL (review H-2): vm.runInNewContext is NOT used in v1 — the
 * script runs in plain module scope with full access to require/import/process.
 * The 'capability-locked WorkflowCtx' is the documented contract surface, NOT a
 * sandbox. A script can reach process/require via constructor walking or direct
 * import. `.dwf.ts` files MUST be commit-reviewed (postinstall-equivalent trust).
 * The path-allowlist (resolveRealContainedPath) limits WHERE scripts load from,
 * not WHAT they can do. isolated-vm (real V8 isolate) is planned for v1.5.
 * See docs/dynamic-workflows.md for the full threat model.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeArtifact } from "../state/artifact-store.ts";
import { appendEvent } from "../state/event-log.ts";
import type { TeamRunManifest, TeamTaskState } from "../state/types.ts";
import { logInternalError } from "../utils/internal-error.ts";
import { packageRoot, projectCrewRoot, userPiRoot } from "../utils/paths.ts";
import { resolveRealContainedPath } from "../utils/safe-paths.ts";
import type { DynamicWorkflowConfig } from "../workflows/workflow-config.ts";
import { assertDeterministicScript, isDeterminismCheckEnabled } from "./deterministic-ast.ts";
import { DwfStore } from "./dwf-state-store.ts";
import { getWorkflowFinalResult, getWorkflowPhaseState, makeWorkflowCtx } from "./dynamic-workflow-context.ts";

export interface RunDynamicWorkflowInput {
	manifest: TeamRunManifest;
	workflow: DynamicWorkflowConfig;
	/** Optional team for role resolution (G4 tier 2). */
	team?: import("../teams/team-config.ts").TeamConfig;
	signal: AbortSignal;
	concurrency?: number;
	modelOverride?: string;
	/** round-14 P1-2: per-workflow token budget. Overrides workflow.maxTokenBudget. */
	tokenBudget?: number;
}

export interface RunDynamicWorkflowResult {
	manifest: TeamRunManifest;
	tasks: TeamTaskState[];
}

/** The signature a .dwf.ts default export must satisfy. */
export type DynamicWorkflowScript = (ctx: import("./dynamic-workflow-context.ts").WorkflowCtx) => Promise<void> | void;

/**
 * round-12 P0-4: defensive structured-clone guard at the runner boundary.
 *
 * Today this is mostly future-proofing: a DWF script's `setResult()` path
 * reads an artifact file as a string, and strings are always structured-
 * cloneable. But if a future code path produces a non-cloneable value
 * (e.g. a Worker postMessage payload that wraps a Symbol or function), we
 * want a clear, actionable error here — not a cryptic `DataCloneError`
 * from deep inside the artifact store. The error message also nudges
 * users toward the most common cause: forgetting `await` on ctx.agent()
 * or ctx.review() in their script.
 */
function assertStructuredCloneable(value: unknown, name: string): void {
	try {
		structuredClone(value);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`${name} must be structured-cloneable; did you forget to await ctx.agent() or ctx.review()? ${detail}`);
	}
}

/**
 * Resolve + validate the script path against the allowlist of workflow dirs (§0c C5).
 * Returns the real contained path or throws.
 *
 * Distinguishes containment errors from other errors (I/O, permission, symlink loops)
 * so the real root cause is surfaced instead of a misleading "outside allowed dirs" message.
 */
function resolveScriptPath(workflow: DynamicWorkflowConfig, cwd: string): string {
	// Allowlist: the script must resolve inside one of the workflow discovery dirs.
	// (discover-workflows.ts only reads from packageRoot/workflows, userPiRoot/workflows,
	//  and projectCrewRoot/workflows — so the script already came from an allowed dir,
	//  but we still validate containment to defeat symlink traversal.)
	const allowedBases = [join(projectCrewRoot(cwd), "workflows"), join(userPiRoot(), "workflows"), join(packageRoot(), "workflows")];
	for (const base of allowedBases) {
		try {
			const real = resolveRealContainedPath(base, workflow.filePath);
			// resolveRealContainedPath returns a string or throws — if it returns, it's valid.
			if (real) return real;
		} catch (error) {
			// Containment errors: swallow and try next base.
			// I/O, permission, symlink errors: re-throw so the real root cause is surfaced.
			const msg = error instanceof Error ? error.message : String(error);
			if (msg.startsWith("Path is outside") || msg.startsWith("Security:")) continue;
			throw error;
		}
	}
	// Not contained in any allowed base — refuse (do NOT fall back to the raw path).
	throw new Error(
		`Dynamic workflow '${workflow.filePath}' is outside the allowed workflows directories (${allowedBases.join(", ")}). Refusing to load.`,
	);
}

/**
 * Transpile + load the .dwf.ts default export. Uses jiti (already a dep) for TS→JS.
 * Returns the default export function or throws.
 *
 * Round-13 P0-2: after reading the script source, run `assertDeterministicScript`
 * to reject non-deterministic calls (Date.now()/Math.random()/new Date()) BEFORE
 * jiti executes the module. The check is opt-out via PI_CREW_DWF_SKIP_DETERMINISM_CHECK=1.
 * For .ts scripts, passes isTypeScript=true so the checker transpiles before parsing
 * (acorn cannot parse TypeScript syntax directly).
 */
async function loadWorkflowModule(scriptPath: string): Promise<DynamicWorkflowScript> {
	// Round-13 P0-2: read source first so we can AST-scan before execution.
	// jiti does not surface the transpiled source back to us, so we read the
	// raw .dwf.ts file. This is the same source jiti will execute.
	const scriptSource = readFileSync(scriptPath, "utf-8");
	const isTypeScript = scriptPath.endsWith(".ts");
	if (isDeterminismCheckEnabled()) {
		assertDeterministicScript(scriptSource, isTypeScript);
	}
	// jiti is the same loader async-runner.ts uses (resolveTypeScriptLoader). We require it
	// lazily so this module stays importable in environments without jiti (type-only consumers).
	// Fix round-4: use createRequire(import.meta.url) so `require` works under the strip-types
	// loader fallback (Node ≥ 22.6) where bare `require` is not defined in ESM scope.
	// LAZY: defer dynamic import of node:module to its call site.
	const { createRequire } = await import("node:module");
	const require = createRequire(import.meta.url);
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const createJiti = require("jiti").default ?? require("jiti");
	const jiti = createJiti(import.meta.url, { interopDefault: true });
	const mod = await jiti(scriptPath);
	const fn = (mod as { default?: unknown }).default ?? mod;
	if (typeof fn !== "function") {
		throw new Error(`Dynamic workflow '${scriptPath}' must export a default async function(ctx).`);
	}
	return fn as DynamicWorkflowScript;
}

/** Build MakeWorkflowCtx options from the run input. */
function buildCtxOptions(
	input: RunDynamicWorkflowInput,
	workflow: DynamicWorkflowConfig,
	signal: AbortSignal,
	resumedState: ReturnType<DwfStore["load"]>,
	dwfStore: DwfStore,
): import("./dynamic-workflow-context.ts").MakeWorkflowCtxOptions {
	return {
		concurrency: input.concurrency ?? workflow.maxConcurrency ?? 4,
		signal,
		team: input.team,
		modelOverride: input.modelOverride,
		tokenBudget: input.tokenBudget ?? workflow.maxTokenBudget,
		args: input.manifest.args,
		resumedState,
		onCheckpoint: (state) => {
			try {
				dwfStore.save(state);
			} catch (error) {
				logInternalError("dynamic-workflow-runner.checkpoint-save", error, `runId=${input.manifest.runId}`);
			}
		},
	};
}

/**
 * Run the dynamic workflow script. Loads it, builds the ctx, executes, and returns
 * {manifest, tasks} with the manifest updated to a terminal status + result artifact.
 *
 * Timeout safety: uses AbortController so the script's ctx.signal fires on timeout,
 * preventing zombie scripts from continuing to write checkpoints and spawn children
 * after the runner declares failure. Checkpoint is cleaned up in a `finally` block
 * on BOTH success and failure paths.
 */
export async function runDynamicWorkflow(input: RunDynamicWorkflowInput): Promise<RunDynamicWorkflowResult> {
	const { manifest, workflow, signal } = input;
	const eventsPath = manifest.eventsPath;
	const scriptPath = resolveScriptPath(workflow, manifest.cwd);

	appendEvent(eventsPath, {
		type: "dwf.started",
		runId: manifest.runId,
		data: { workflow: workflow.name, script: scriptPath },
	});

	// round-18 P2-3: resume/checkpoint. Load any existing checkpoint for this run's stateRoot.
	// stateRoot is already <crewRoot>/state/runs/<runId>, so the checkpoint lands at
	// <stateRoot>/dwf-checkpoint.json (no double-nesting). A missing checkpoint (fresh run)
	// yields undefined — makeWorkflowCtx starts with empty defaults (backward compatible).
	const dwfStore = new DwfStore(manifest.stateRoot);
	const resumedState = dwfStore.load();
	if (resumedState) {
		appendEvent(eventsPath, {
			type: "dwf.resumed",
			runId: manifest.runId,
			data: {
				agentCount: resumedState.agentCount,
				phases: resumedState.phases,
				currentPhase: resumedState.currentPhase,
			},
		});
	}

	try {
		const script = await loadWorkflowModule(scriptPath);

		// Timeout handling: use AbortController so the script's ctx.signal fires on timeout.
		// This fixes the zombie-script problem where Promise.race would abandon the script
		// promise without stopping it — the script would continue calling ctx.agent() and
		// writing checkpoints after the runner declared failure.
		const parsedTimeout = Number.parseInt(process.env.PI_CREW_DWF_SCRIPT_TIMEOUT_MS ?? "", 10);
		const SCRIPT_TIMEOUT_MS = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 600_000; // 10 min default
		let timeoutHandle: NodeJS.Timeout | undefined;
		const scriptController = new AbortController();
		// Combine the external signal (e.g. cancellation) with the timeout signal.
		const combinedSignal = AbortSignal.any([signal, scriptController.signal]);

		const timedCtx = makeWorkflowCtx(manifest, buildCtxOptions(input, workflow, combinedSignal, resumedState, dwfStore));
		const frozenTimedCtx = Object.freeze(timedCtx);

		const timeoutPromise = new Promise<never>((_, reject) => {
			timeoutHandle = setTimeout(() => {
				scriptController.abort(); // Signal the script to stop
				reject(
					new Error(
						`Dynamic workflow script timed out after ${SCRIPT_TIMEOUT_MS}ms. The script may have spawned a child process that did not exit. Check for spawn/exec calls without proper stdio handling.`,
					),
				);
			}, SCRIPT_TIMEOUT_MS);
			timeoutHandle.unref?.();
		});
		try {
			await Promise.race([script(frozenTimedCtx), timeoutPromise]);
		} finally {
			if (timeoutHandle) clearTimeout(timeoutHandle);
		}

		const final = getWorkflowFinalResult(timedCtx);
		const finalText = final
			? readFinalArtifact(final.artifactPath)
			: `(dynamic workflow '${workflow.name}' completed without calling ctx.setResult())`;

		assertStructuredCloneable(finalText, "final artifact content (set via ctx.setResult)");

		const summary = writeArtifact(manifest.artifactsRoot, {
			kind: "result",
			relativePath: "summary.md",
			content: finalText,
			producer: "dynamic-workflow",
		});

		// Safety net: close the last open phase before completing.
		const phaseState = getWorkflowPhaseState(timedCtx);
		if (phaseState?.currentPhase !== undefined) {
			appendEvent(eventsPath, {
				type: "dwf.phase_completed",
				runId: manifest.runId,
				data: { phase: phaseState.currentPhase },
			});
			phaseState.currentPhase = undefined;
		}

		appendEvent(eventsPath, {
			type: "dwf.completed",
			runId: manifest.runId,
			data: { workflow: workflow.name, summaryArtifact: summary.path },
		});

		const summaryText = finalText.slice(0, 2000);
		assertStructuredCloneable(summaryText, "manifest.summary (derived from final result)");

		const updatedManifest: TeamRunManifest = {
			...manifest,
			status: "completed",
			summary: summaryText,
			updatedAt: new Date().toISOString(),
			artifacts: [...manifest.artifacts, summary],
		};
		return { manifest: updatedManifest, tasks: [] };
	} catch (error) {
		logInternalError("dynamic-workflow-runner.run", error, `runId=${manifest.runId}, workflow=${workflow.name}`);
		appendEvent(eventsPath, {
			type: "dwf.failed",
			runId: manifest.runId,
			data: {
				error: error instanceof Error ? error.message : String(error),
			},
		});
		throw error;
	} finally {
		// Clean up the checkpoint on BOTH success and failure paths.
		// On success: cleared so a fresh re-run starts from scratch.
		// On failure: cleared so a retry doesn't load a partial/corrupt checkpoint
		// written by a crashing or timed-out zombie script.
		dwfStore.delete();
	}
}

function readFinalArtifact(artifactPath: string): string {
	try {
		return readFileSync(artifactPath, "utf-8");
	} catch (error) {
		logInternalError("dynamic-workflow-runner.readFinal", error, `artifactPath=${artifactPath}`);
		return `(failed to read final artifact ${artifactPath})`;
	}
}
