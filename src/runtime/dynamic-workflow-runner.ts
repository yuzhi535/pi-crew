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
import { resolveRealContainedPath } from "../utils/safe-paths.ts";
import { appendEvent } from "../state/event-log.ts";
import { writeArtifact } from "../state/artifact-store.ts";
import { logInternalError } from "../utils/internal-error.ts";
import { makeWorkflowCtx, getWorkflowFinalResult } from "./dynamic-workflow-context.ts";
import { projectCrewRoot } from "../utils/paths.ts";
import type { DynamicWorkflowConfig } from "../workflows/workflow-config.ts";
import type { TeamRunManifest, TeamTaskState } from "../state/types.ts";

export interface RunDynamicWorkflowInput {
	manifest: TeamRunManifest;
	workflow: DynamicWorkflowConfig;
	/** Optional team for role resolution (G4 tier 2). */
	team?: import("../teams/team-config.ts").TeamConfig;
	signal: AbortSignal;
	concurrency?: number;
	modelOverride?: string;
}

export interface RunDynamicWorkflowResult {
	manifest: TeamRunManifest;
	tasks: TeamTaskState[];
}

/** The signature a .dwf.ts default export must satisfy. */
export type DynamicWorkflowScript = (ctx: import("./dynamic-workflow-context.ts").WorkflowCtx) => Promise<void> | void;

/**
 * Resolve + validate the script path against the allowlist of workflow dirs (§0c C5).
 * Returns the real contained path or throws.
 */
function resolveScriptPath(workflow: DynamicWorkflowConfig, cwd: string): string {
	const crewRoot = projectCrewRoot(cwd);
	// Allowlist: the script must resolve inside one of the workflow discovery dirs.
	// (discover-workflows.ts only reads from packageRoot/workflows, userPiRoot/workflows,
	//  and projectCrewRoot/workflows — so the script already came from an allowed dir,
	//  but we still validate containment to defeat symlink traversal.)
	const allowed = [`${crewRoot}/workflows`, workflow.filePath];
	for (const base of allowed) {
		try {
			const real = resolveRealContainedPath(base, workflow.filePath);
			if (real) return real;
		} catch {
			// try next base
		}
	}
	return workflow.filePath; // fall back; discovery already validated provenance.
}

/**
 * Transpile + load the .dwf.ts default export. Uses jiti (already a dep) for TS→JS.
 * Returns the default export function or throws.
 */
async function loadWorkflowModule(scriptPath: string): Promise<DynamicWorkflowScript> {
	// jiti is the same loader async-runner.ts uses (resolveTypeScriptLoader). We require it
	// lazily so this module stays importable in environments without jiti (type-only consumers).
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

/**
 * Run the dynamic workflow script. Loads it, builds the ctx, executes, and returns
 * {manifest, tasks} with the manifest updated to a terminal status + result artifact.
 */
export async function runDynamicWorkflow(input: RunDynamicWorkflowInput): Promise<RunDynamicWorkflowResult> {
	const { manifest, workflow, signal } = input;
	const eventsPath = manifest.eventsPath;
	const scriptPath = resolveScriptPath(workflow, manifest.cwd);

	appendEvent(eventsPath, { type: "dwf.started", runId: manifest.runId, data: { workflow: workflow.name, script: scriptPath } });

	const ctx = makeWorkflowCtx(manifest, {
		concurrency: input.concurrency ?? workflow.maxConcurrency ?? 4,
		signal,
		team: input.team,
		modelOverride: input.modelOverride,
	});

	// Freeze the ctx so the script cannot add/override capability methods (§0c C4).
	const frozenCtx = Object.freeze(ctx);

	try {
		const script = await loadWorkflowModule(scriptPath);
		await script(frozenCtx);
	} catch (error) {
		logInternalError("dynamic-workflow-runner.run", error, `runId=${manifest.runId}, workflow=${workflow.name}`);
		appendEvent(eventsPath, { type: "dwf.failed", runId: manifest.runId, data: { error: error instanceof Error ? error.message : String(error) } });
		// Re-throw so background-runner's error handling marks the run failed.
		throw error;
	}

	const final = getWorkflowFinalResult(ctx);
	const finalText = final ? readFinalArtifact(final.artifactPath) : `(dynamic workflow '${workflow.name}' completed without calling ctx.setResult())`;

	// Write a summary artifact mirroring the static-workflow summary.md contract (run.ts reads this).
	const summary = writeArtifact(manifest.artifactsRoot, {
		kind: "result",
		relativePath: "summary.md",
		content: finalText,
		producer: "dynamic-workflow",
	});

	appendEvent(eventsPath, { type: "dwf.completed", runId: manifest.runId, data: { workflow: workflow.name, summaryArtifact: summary.path } });

	const updatedManifest: TeamRunManifest = {
		...manifest,
		status: "completed",
		summary: finalText.slice(0, 2000),
		updatedAt: new Date().toISOString(),
		artifacts: [...manifest.artifacts, summary],
	};
	return { manifest: updatedManifest, tasks: [] };
}

function readFinalArtifact(artifactPath: string): string {
	try {
		return readFileSync(artifactPath, "utf-8");
	} catch (error) {
		logInternalError("dynamic-workflow-runner.readFinal", error, `artifactPath=${artifactPath}`);
		return `(failed to read final artifact ${artifactPath})`;
	}
}
