// src/workflows/preflight-validator.ts
//
// Decision tree from .crew/knowledge.md "pi-crew USAGE THRESHOLD RULE"
// (3-step refined rule, 2026-06-29). The validator runs synchronously
// before executeTeamRun and returns a structured result; it NEVER throws.
// Call sites decide whether to short-circuit (block) or just log (warn).
//
// The validator is a pure function: it accepts an optional eventAppender
// in PreflightOptions for future telemetry wiring but does NOT call it
// itself. Integration call sites (Phase 3) will fire telemetry from the
// result they receive. This keeps the validator side-effect free and
// trivially testable.

import {
	analyzeWorkflowTopology,
	type WorkflowTopology,
} from "./topology-analyzer.ts";
import type { WorkflowConfig } from "./workflow-config.ts";

export interface PreflightOptions {
	/** When true, downgrade any block/warn to allow. Audit trail should log the override. */
	force?: boolean;
	/** Optional hook reserved for future telemetry wiring. Not invoked by the validator. */
	eventAppender?: (eventsPath: string, event: object) => void;
}

export interface PreflightResult {
	/**
	 * Advisory severity. NEVER blocks execution — all levels log a note and proceed.
	 * - `info`  — context-only, e.g. dynamic workflow, force-bypass acknowledged.
	 * - `note`  — topology=`concurrent` or `complex-dag`: validated good use cases.
	 * - `warn`  — potential misuse (single / sequential 2–3 / 4+ sequential). Provides
	 *             the measured cost evidence (Run #3, Run #1) so the agent can decide
	 *             whether to proceed or refactor into raw Agent calls.
	 */
	level: "info" | "note" | "warn";
	message: string;
	suggestion: string;
	topology: WorkflowTopology;
	/** Mirrored from TopologyAnalysis for telemetry — useful to scope warn events. */
	stepCount: number;
	/** Mirrored from TopologyAnalysis — what the analyzer recommends. */
	recommendation: string;
}

function info(
	topology: WorkflowTopology,
	stepCount: number,
	recommendation: string,
	message: string,
): PreflightResult {
	return {
		level: "info",
		message,
		suggestion: "",
		topology,
		stepCount,
		recommendation,
	};
}

function note(
	topology: WorkflowTopology,
	stepCount: number,
	recommendation: string,
	message: string,
): PreflightResult {
	return {
		level: "note",
		message,
		suggestion: "Validated use case — proceeding.",
		topology,
		stepCount,
		recommendation,
	};
}

function warn(
	topology: WorkflowTopology,
	stepCount: number,
	recommendation: string,
	message: string,
	suggestion: string,
): PreflightResult {
	return {
		level: "warn",
		message,
		suggestion,
		topology,
		stepCount,
		recommendation,
	};
}

/**
 * Validate workflow usage against the topology threshold rule.
 *
 * **Returns a PreflightResult. NEVER blocks the call.** The validator is advisory only —
 * the agent (caller) decides whether to proceed, refactor, or override. This honors
 * Pi's design philosophy: tooling provides information, agents exercise judgment.
 *
 * Severity levels:
 * - `info`  — context-only (dynamic, force-bypass acknowledged).
 * - `note`  — validated use case (`concurrent`, `complex-dag`). Proceed.
 * - `warn`  — potential inefficiency. Provides measured cost evidence so the agent
 *             can weigh the trade-off (e.g. audit-trail value vs. raw-call speed).
 *
 * No `block` level exists — there is no scenario where pi-crew hard-rejects a call.
 * The agent always gets to decide.
 */
export function validateWorkflowUsage(
	workflow: WorkflowConfig,
	options: PreflightOptions = {},
): PreflightResult {
	const analysis = analyzeWorkflowTopology(workflow);
	const { topology, stepCount, recommendation } = analysis;

	// Rule 0: dynamic workflows are runtime-decided.
	if (topology === "dynamic") {
		return info(
			topology,
			stepCount,
			recommendation,
			"Dynamic workflow — runtime decides topology.",
		);
	}

	// Rule 0b: explicit force-bypass acknowledged (still log it).
	if (options.force === true) {
		return info(
			topology,
			stepCount,
			recommendation,
			`Force-bypassed preflight acknowledged (topology=${topology}, stepCount=${stepCount}). Proceeding as requested.`,
		);
	}

	// Rule 1: SINGLE — advisory note that raw Agent would be simpler.
	if (topology === "single") {
		return warn(
			topology,
			stepCount,
			recommendation,
			"Single-task workflow: pi-crew overhead exceeds benefit; raw Agent tool would be ~30× faster and ~5× cheaper. Proceeding anyway — proceed only if audit trail or team coordination matters here.",
			"Consider using the raw Agent tool instead. If proceeding, no action needed — pi-crew will run the workflow as configured.",
		);
	}

	// Rule 2: SEQUENTIAL — note per chain length with measured cost evidence.
	if (topology === "sequential") {
		if (stepCount === 2) {
			return warn(
				topology,
				stepCount,
				recommendation,
				"2-step sequential chain: pi-crew adds overhead; 2 raw Agent calls would be faster. Proceeding anyway.",
				"Consider 2 raw Agent calls in one turn if speed matters. Otherwise, no action needed.",
			);
		}
		if (stepCount === 3) {
			return warn(
				topology,
				stepCount,
				recommendation,
				"3-step sequential chain: measured 5.7× slower and 1.9× costlier than 3 raw Agent calls (Run #3 in .crew/state/runs/). Proceeding anyway.",
				"Consider 3 raw Agent calls. If audit trail justifies overhead, proceed.",
			);
		}
		return warn(
			topology,
			stepCount,
			recommendation,
			`${stepCount}-step sequential chain: longer chains may justify pi-crew for audit/dag-context reasons, but raw Agent calls remain faster. Proceeding anyway.`,
			"Consider chaining raw Agent calls if speed matters. Otherwise, no action needed.",
		);
	}

	// Rule 3: CONCURRENT — validated good use case, informational note.
	if (topology === "concurrent") {
		return note(
			topology,
			stepCount,
			recommendation,
			`Validated use case: ${analysis.fanOutDegree}-way parallel fan-out. pi-crew's parallelism wins here.`,
		);
	}

	// Rule 4: COMPLEX_DAG — validated good use case, informational note.
	return note(
		topology,
		stepCount,
		recommendation,
		`Validated use case: complex DAG with ${stepCount} steps, depth ${analysis.dagDepth}. pi-crew's dependency-context injection and adaptive-plan support wins here.`,
	);
}
