// src/workflows/topology-analyzer.ts
//
// Workflow topology classifier. Given a WorkflowConfig, returns a TopologyAnalysis
// describing the structural shape (single / sequential / concurrent / complex-dag
// / dynamic). The shape is used by the preflight validator to enforce the
// "don't use pi-crew for sequential independent agents" rule from .crew/knowledge.md.
//
// Algorithm (high level):
//   1. runtime === "dynamic"  →  DYNAMIC  (chain/script workflows decide at runtime)
//   2. stepCount === 1        →  SINGLE   (one step: no concurrency, no DAG)
//   3. parallelGroupCount >= 1 AND max-fanout >= 3  →  CONCURRENT
//   4. stepCount >= 4 AND has-multi-deps  →  COMPLEX_DAG
//   5. else                   →  SEQUENTIAL
//
// "Has-multi-deps" = at least one step lists 2+ dependsOn. This is the
// unambiguous signal of a branching DAG (diamond patterns, fan-in joins).
// Plain linear chains with high depth are still SEQUENTIAL — Run #3 fast-fix
// (3 steps linear, depth 3) and the default workflow (4 steps linear, depth 4)
// are both sequential by this rule; raw Agent calls are faster for both.

import type { WorkflowConfig, WorkflowStep } from "./workflow-config.ts";

export type WorkflowTopology =
	| "single"
	| "sequential"
	| "concurrent"
	| "complex-dag"
	| "dynamic";

export type TopologyRecommendation =
	| "raw_agent"
	| "fast_fix"
	| "parallel_research"
	| "implementation_adaptive"
	| "any";

export interface TopologyAnalysis {
	topology: WorkflowTopology;
	stepCount: number;
	parallelGroupCount: number;
	fanOutDegree: number;
	dagDepth: number;
	recommendation: TopologyRecommendation;
	reason: string;
}

/** Distinct parallelGroup values across all steps. Empty if no step sets a group. */
export function parallelGroupsFromSteps(steps: WorkflowStep[]): Set<string> {
	const out = new Set<string>();
	for (const step of steps) {
		if (step.parallelGroup !== undefined) out.add(step.parallelGroup);
	}
	return out;
}

/** Max group size across all parallelGroup values. 0 if no step sets a group. */
export function fanOutDegreeFromSteps(steps: WorkflowStep[]): number {
	const counts = new Map<string, number>();
	for (const step of steps) {
		if (step.parallelGroup === undefined) continue;
		counts.set(
			step.parallelGroup,
			(counts.get(step.parallelGroup) ?? 0) + 1,
		);
	}
	let max = 0;
	for (const count of counts.values()) if (count > max) max = count;
	return max;
}

/**
 * Longest-path DAG depth from roots. A root is a step with no dependsOn.
 * Returns 0 for an empty list, 1 for a list of roots only with no inter-step deps.
 *
 * Defensive: a step depending on an unknown id is treated as a root
 * (validate-workflow.ts catches real cycles before this runs; this is
 * belt-and-suspenders against malformed inputs).
 */
export function dagDepthFromSteps(steps: WorkflowStep[]): number {
	if (steps.length === 0) return 0;
	const ids = new Set(steps.map((s) => s.id));
	// Build adjacency and indegree. Unknown deps are dropped to avoid phantom edges.
	const indeg = new Map<string, number>();
	const adj = new Map<string, string[]>();
	for (const step of steps) {
		const deps = (step.dependsOn ?? []).filter((d) => ids.has(d));
		indeg.set(step.id, deps.length);
		// step.id's parents are deps; deps's children include step.id.
		adj.set(step.id, adj.get(step.id) ?? []);
		for (const dep of deps) {
			const children = adj.get(dep) ?? [];
			children.push(step.id);
			adj.set(dep, children);
		}
	}
	// Kahn-style BFS. depth[v] = max(depth[parent]) + 1, roots = 1.
	const depth = new Map<string, number>();
	const queue: string[] = [];
	for (const [id, n] of indeg) {
		if (n === 0) {
			depth.set(id, 1);
			queue.push(id);
		}
	}
	let maxDepth = 0;
	while (queue.length > 0) {
		const v = queue.shift()!;
		const dv = depth.get(v) ?? 0;
		if (dv > maxDepth) maxDepth = dv;
		for (const child of adj.get(v) ?? []) {
			const cand = dv + 1;
			if (cand > (depth.get(child) ?? 0)) depth.set(child, cand);
			indeg.set(child, (indeg.get(child) ?? 0) - 1);
			if ((indeg.get(child) ?? 0) === 0) queue.push(child);
		}
	}
	return maxDepth;
}

/** True if at least one step lists 2+ dependsOn entries. */
function hasMultiDeps(steps: WorkflowStep[]): boolean {
	for (const step of steps) {
		if ((step.dependsOn?.length ?? 0) >= 2) return true;
	}
	return false;
}

/**
 * Classify a workflow's topology. See file header for the rule order.
 * Pure function — no I/O, no side effects, no exceptions.
 */
export function analyzeWorkflowTopology(
	workflow: WorkflowConfig,
): TopologyAnalysis {
	// Chain/dynamic workflows: runtime decides the topology at execution time.
	// Don't try to classify the empty `steps: []` (DynamicWorkflowConfig forces
	// it to be empty).
	if (workflow.runtime === "dynamic") {
		return {
			topology: "dynamic",
			stepCount: 0,
			parallelGroupCount: 0,
			fanOutDegree: 0,
			dagDepth: 0,
			recommendation: "any",
			reason: "Chain/dynamic workflow — runtime decides topology",
		};
	}

	const steps = workflow.steps;
	const stepCount = steps.length;
	const parallelGroupCount = parallelGroupsFromSteps(steps).size;
	const fanOutDegree = fanOutDegreeFromSteps(steps);
	const dagDepth = dagDepthFromSteps(steps);

	// Explicit topology override from frontmatter `topology:` field.
	// When set, the author has already classified the workflow — respect that.
	// We still compute structural metrics so telemetry can show the delta.
	if (workflow.topology !== undefined && workflow.topology !== "dynamic") {
		const recommendation: TopologyRecommendation =
			workflow.topology === "single" || workflow.topology === "sequential"
				? "raw_agent"
				: workflow.topology === "concurrent"
					? "parallel_research"
					: workflow.topology === "complex-dag"
						? "implementation_adaptive"
						: "any";
		return {
			topology: workflow.topology,
			stepCount,
			parallelGroupCount,
			fanOutDegree,
			dagDepth,
			recommendation,
			reason: `Explicit topology from frontmatter: '${workflow.topology}'`,
		};
	}

	let topology: WorkflowTopology;
	let recommendation: TopologyRecommendation;
	let reason: string;

	// Note: explicit `workflow.topology` override is handled BEFORE the variable
	// declarations below (in the block above). If we reach here, auto-classify.

	if (stepCount === 1) {
		topology = "single";
		recommendation = "raw_agent";
		reason =
			"Single-task workflow: no concurrency or DAG structure to justify pi-crew overhead.";
	} else if (parallelGroupCount >= 1 && fanOutDegree >= 3) {
		topology = "concurrent";
		recommendation = "parallel_research";
		reason = `Concurrent fan-out: ${fanOutDegree} steps in parallel group(s) of size ≥3.`;
	} else if (stepCount >= 4 && hasMultiDeps(steps)) {
		topology = "complex-dag";
		recommendation = "implementation_adaptive";
		reason = `Complex DAG: ${stepCount} steps with branching (≥2 deps on ≥1 node), depth ${dagDepth}.`;
	} else {
		topology = "sequential";
		if (stepCount <= 3) {
			recommendation = "raw_agent";
			reason = `Sequential chain of ${stepCount} steps — raw Agent calls are faster.`;
		} else {
			recommendation = "fast_fix";
			reason = `Sequential chain of ${stepCount} steps — audit-trail-justified, but raw calls remain faster.`;
		}
	}

	return {
		topology,
		stepCount,
		parallelGroupCount,
		fanOutDegree,
		dagDepth,
		recommendation,
		reason,
	};
}
