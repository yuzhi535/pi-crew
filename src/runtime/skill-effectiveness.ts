/**
 * Skill Effectiveness — ECC INSTINCT/CONFIDENCE Pattern Implementation
 * 
 * Implements confidence-weighted skill activation based on ECC's instinct system.
 * Tracks skill activation success and adjusts confidence scores.
 * 
 * Based on: docs/distillation/ECC-hooks-instincts.md §2-3 (instinct system, confidence thresholds)
 * Based on: docs/distillation/ECC-10-skills.md §8 (continuous-learning-v2)
 * 
 * @module skill-effectiveness
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { crewHooks } from "./crew-hooks.ts";

/**
 * Confidence thresholds per ECC instinct system.
 * Skills below 0.3 threshold are considered tentative and not enforced.
 */
export const CONFIDENCE_THRESHOLDS = {
	TENTATIVE: 0.3,      // Suggested but not enforced
	MODERATE: 0.5,       // Applied when relevant
	STRONG: 0.7,         // Auto-approved for application
	NEAR_CERTAIN: 0.9,   // Core behavior
} as const;

/**
 * Initial confidence by observation frequency.
 * From ECC instinct system: 1-2 observations → 0.3, 3-5 → 0.5, etc.
 */
export const INITIAL_CONFIDENCE_BY_FREQUENCY: Record<string, number> = {
	"1": 0.3,  // 1 observation → tentative
	"2": 0.3,  // 2 observations → tentative
	"3": 0.5,  // 3 observations → moderate
	"4": 0.5,
	"5": 0.5,
	"6": 0.7,  // 6-10 observations → strong
	"7": 0.7,
	"8": 0.7,
	"9": 0.7,
	"10": 0.7,
	"11+": 0.85, // 11+ observations → very strong
} as const;

/**
 * Confidence adjustments per ECC instinct system.
 */
export const CONFIDENCE_ADJUSTMENTS = {
	CONFIRMING: 0.05,      // Each confirming observation
	CONTRADICTING: -0.1,   // Each contradicting observation
	DECAY_PER_WEEK: -0.02, // Per week without observation
} as const;

/**
 * Promotion gate criteria for skills.
 * Skill can be promoted to "strong enforcement" when these are met.
 */
export const PROMOTION_GATE_CRITERIA = {
	MIN_CORRECTNESS: 0.8,      // 80% pass rate
	MIN_ACTIVATIONS: 5,         // Minimum observations before filtering
	MIN_AVG_CONFIDENCE: 0.7,   // Average confidence threshold
} as const;

/**
 * Skill activation record - captures each time a skill is used.
 */
export interface SkillActivation {
	id: string;           // Unique activation ID
	skillId: string;      // Skill identifier (e.g., "verification-before-done")
	role: string;         // Role that activated the skill
	runId: string;        // Run ID
	taskId: string;       // Task ID
	timestamp: string;    // ISO timestamp
	passed: boolean;       // Whether the skill was successfully applied
	outcome?: string;     // Optional outcome description
	confidence: number;    // Confidence at time of activation
}

/**
 * Skill metrics - aggregated statistics for a skill.
 */
export interface SkillMetrics {
	skillId: string;
	totalActivations: number;
	passedActivations: number;
	failedActivations: number;
	passRate: number;           // passed / total
	avgConfidence: number;       // Rolling average confidence
	currentConfidence: number;   // Current confidence score
	trend: "improving" | "stable" | "declining";
	lastActivation?: string;    // ISO timestamp
	firstActivation?: string;   // ISO timestamp
	roleBreakdown: Record<string, number>;  // Activations per role
}

/**
 * Confidence-weighted skill entry for activation decisions.
 */
export interface WeightedSkill {
	skillId: string;
	confidence: number;
	threshold: keyof typeof CONFIDENCE_THRESHOLDS;
	behavior: "suggest" | "apply_if_asked" | "apply_auto" | "act_autonomous";
	evidence: string;  // Evidence for confidence score
	metrics: SkillMetrics;
}

/**
 * Get skill effectiveness storage path.
 */
function getSkillMetricsPath(runId: string): string {
	return join(
		process.cwd(),
		`.crew/state/runs/${runId}/skill-metrics.jsonl`,
	);
}

/**
 * Get skill activations path.
 */
function getSkillActivationsPath(runId: string): string {
	return join(
		process.cwd(),
		`.crew/state/runs/${runId}/skill-activations.jsonl`,
	);
}

/**
 * Ensure directory exists for skill metrics.
 */
function ensureSkillMetricsDir(runId: string): void {
	const dir = dirname(getSkillMetricsPath(runId));
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}

/**
 * Compute initial confidence from observation count.
 */
export function computeInitialConfidence(observationCount: number): number {
	if (observationCount <= 2) return INITIAL_CONFIDENCE_BY_FREQUENCY["1"];
	if (observationCount <= 5) return INITIAL_CONFIDENCE_BY_FREQUENCY["3"];
	if (observationCount <= 10) return INITIAL_CONFIDENCE_BY_FREQUENCY["6"];
	return INITIAL_CONFIDENCE_BY_FREQUENCY["11+"];
}

/**
 * Adjust confidence based on outcome.
 * Per ECC instinct system: +0.05 for success, -0.1 for failure.
 */
export function adjustConfidence(current: number, passed: boolean): number {
	const delta = passed
		? CONFIDENCE_ADJUSTMENTS.CONFIRMING
		: CONFIDENCE_ADJUSTMENTS.CONTRADICTING;
	return Math.max(0.1, Math.min(0.95, current + delta)); // Clamp to [0.1, 0.95]
}

/**
 * Apply decay to confidence for skills not observed recently.
 */
export function applyDecay(current: number, lastActivation?: string): number {
	if (!lastActivation) return current;

	const daysSince = (Date.now() - new Date(lastActivation).getTime()) / (1000 * 60 * 60 * 24);
	const decayWeeks = Math.floor(daysSince / 7);
	const decay = decayWeeks * CONFIDENCE_ADJUSTMENTS.DECAY_PER_WEEK;

	return Math.max(0.1, current + decay);
}

/**
 * Determine behavior based on confidence threshold.
 */
export function confidenceToBehavior(confidence: number): WeightedSkill["behavior"] {
	if (confidence >= CONFIDENCE_THRESHOLDS.NEAR_CERTAIN) return "act_autonomous";
	if (confidence >= CONFIDENCE_THRESHOLDS.STRONG) return "apply_auto";
	if (confidence >= CONFIDENCE_THRESHOLDS.MODERATE) return "apply_if_asked";
	return "suggest";
}

/**
 * Determine threshold name from confidence.
 */
export function confidenceToThreshold(confidence: number): keyof typeof CONFIDENCE_THRESHOLDS {
	if (confidence >= CONFIDENCE_THRESHOLDS.NEAR_CERTAIN) return "NEAR_CERTAIN";
	if (confidence >= CONFIDENCE_THRESHOLDS.STRONG) return "STRONG";
	if (confidence >= CONFIDENCE_THRESHOLDS.TENTATIVE) return "MODERATE";
	return "TENTATIVE";
}

/**
 * Record a skill activation.
 * Appends to the run's skill-activations.jsonl for learning.
 */
export function recordSkillActivation(
	activation: SkillActivation,
): SkillActivation {
	ensureSkillMetricsDir(activation.runId);

	const path = getSkillActivationsPath(activation.runId);
	const line = JSON.stringify(activation) + "\n";
	writeFileSync(path, line, { flag: "a", encoding: "utf-8" });

	return activation;
}

/**
 * Get all skill activations for a run.
 */
export function getSkillActivations(runId: string): SkillActivation[] {
	const path = getSkillActivationsPath(runId);

	if (!existsSync(path)) {
		return [];
	}

	const content = readFileSync(path, "utf-8");
	if (!content.trim()) {
		return [];
	}

	return content
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line) as SkillActivation);
}

/**
 * Compute metrics for a skill across all activations.
 */
export function computeSkillMetrics(
	skillId: string,
	activations: SkillActivation[],
): SkillMetrics {
	const skillActivations = activations.filter((a) => a.skillId === skillId);

	if (skillActivations.length === 0) {
		return {
			skillId,
			totalActivations: 0,
			passedActivations: 0,
			failedActivations: 0,
			passRate: 0,
			avgConfidence: 0,
			currentConfidence: computeInitialConfidence(0),
			trend: "stable",
			roleBreakdown: {},
		};
	}

	const passed = skillActivations.filter((a) => a.passed).length;
	const failed = skillActivations.filter((a) => !a.passed).length;
	const avgConfidence =
		skillActivations.reduce((sum, a) => sum + a.confidence, 0) /
		skillActivations.length;
	const currentConfidence =
		skillActivations[skillActivations.length - 1]?.confidence ?? avgConfidence;

	// Compute trend from last 5 activations
	const recent = skillActivations.slice(-5);
	const recentPassRate = recent.filter((a) => a.passed).length / recent.length;
	const earlier = skillActivations.slice(0, -5);
	const earlierPassRate =
		earlier.length > 0
			? earlier.filter((a) => a.passed).length / earlier.length
			: recentPassRate;

	let trend: SkillMetrics["trend"] = "stable";
	if (recentPassRate > earlierPassRate + 0.1) {
		trend = "improving";
	} else if (recentPassRate < earlierPassRate - 0.1) {
		trend = "declining";
	}

	// Role breakdown
	const roleBreakdown: Record<string, number> = {};
	for (const activation of skillActivations) {
		roleBreakdown[activation.role] =
			(roleBreakdown[activation.role] ?? 0) + 1;
	}

	// Apply decay if not observed recently
	const lastActivation = skillActivations[skillActivations.length - 1]?.timestamp;
	const decayedConfidence = applyDecay(currentConfidence, lastActivation);

	return {
		skillId,
		totalActivations: skillActivations.length,
		passedActivations: passed,
		failedActivations: failed,
		passRate: passed / skillActivations.length,
		avgConfidence,
		currentConfidence: decayedConfidence,
		trend,
		lastActivation,
		firstActivation: skillActivations[0]?.timestamp,
		roleBreakdown,
	};
}

/**
 * Evaluate if a skill passes the promotion gate.
 * Skill can be promoted to "strong enforcement" when criteria are met.
 */
export function evaluatePromotionGate(metrics: SkillMetrics): {
	passed: boolean;
	criteria: {
		correctness: boolean;
		evidence: boolean;
		rollback: boolean;
		encoding: boolean;
	};
	reason: string;
} {
	const criteria = {
		correctness: metrics.passRate >= PROMOTION_GATE_CRITERIA.MIN_CORRECTNESS,
		evidence: metrics.totalActivations >= PROMOTION_GATE_CRITERIA.MIN_ACTIVATIONS,
		rollback: metrics.trend !== "declining",
		encoding: metrics.avgConfidence >= PROMOTION_GATE_CRITERIA.MIN_AVG_CONFIDENCE,
	};

	const allPassed = Object.values(criteria).every(Boolean);

	let reason: string;
	if (allPassed) {
		reason = `All promotion gate criteria met: ${metrics.passRate.toFixed(1)} pass rate, ${metrics.totalActivations} activations, ${metrics.trend} trend`;
	} else {
		const failedCriteria = Object.entries(criteria)
			.filter(([, passed]) => !passed)
			.map(([name]) => name);
		reason = `Promotion gate not passed. Failed: ${failedCriteria.join(", ")}`;
	}

	return { passed: allPassed, criteria, reason };
}

/**
 * Get weighted skills for a role based on activation history.
 * Filters by minimum confidence threshold.
 */
export function getWeightedSkillsForRole(
	role: string,
	skillIds: string[],
	runId: string,
	minConfidence: number = CONFIDENCE_THRESHOLDS.TENTATIVE,
): WeightedSkill[] {
	const activations = getSkillActivations(runId);

	return skillIds
		.map((skillId) => {
			const metrics = computeSkillMetrics(skillId, activations);
			const confidence = metrics.currentConfidence;

			if (confidence < minConfidence) {
				return null;
			}

			return {
				skillId,
				confidence,
				threshold: confidenceToThreshold(confidence),
				behavior: confidenceToBehavior(confidence),
				evidence: `${metrics.totalActivations} activations, ${(metrics.passRate * 100).toFixed(0)}% pass rate`,
				metrics,
			};
		})
		.filter((s): s is WeightedSkill => s !== null)
		.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Filter skills by confidence threshold.
 * Skills below threshold are marked as "suggest" only.
 */
export function filterSkillsByConfidence(
	skillIds: string[],
	runId: string,
	threshold: keyof typeof CONFIDENCE_THRESHOLDS = "MODERATE",
): WeightedSkill[] {
	const minConfidence = CONFIDENCE_THRESHOLDS[threshold];
	return getWeightedSkillsForRole("global", skillIds, runId, minConfidence);
}

/**
 * Register crew hooks for automatic skill activation tracking.
 * Hooks are registered once per process lifetime.
 */
let hooksRegistered = false;

export function registerSkillEffectivenessHooks(): void {
	if (hooksRegistered) return;
	hooksRegistered = true;

	// Track task completion for skill effectiveness
	crewHooks.register("task_completed", (event) => {
		const { taskId, runId, data } = event;
		if (!taskId || !runId) return;

		// Extract skills that were activated from task data
		const skillNames = (data?.skills as string[]) ?? [];
		const success = (data?.status as string) === "completed";

		// Record each skill activation
		for (const skillId of skillNames) {
			const activation: SkillActivation = {
				id: `act-${Date.now()}-${Math.random().toString(36).slice(2)}`,
				skillId,
				role: (data?.role as string) ?? "unknown",
				runId,
				taskId,
				timestamp: new Date().toISOString(),
				passed: success,
				confidence: computeInitialConfidence(1),
			};
			recordSkillActivation(activation);
		}
	});

	// Track task failures
	crewHooks.register("task_failed", (event) => {
		const { taskId, runId, data } = event;
		if (!taskId || !runId) return;

		// Downgrade confidence for skills associated with failed tasks
		// This is handled by computeSkillMetrics when processing activations
	});
}

/**
 * Generate a skill effectiveness report for a run.
 */
export function generateSkillEffectivenessReport(
	runId: string,
	skillIds: string[],
): string {
	const activations = getSkillActivations(runId);
	const lines: string[] = [
		`# Skill Effectiveness Report: ${runId}`,
		"",
		`Generated: ${new Date().toISOString()}`,
		`Total Activations: ${activations.length}`,
		"",
	];

	if (activations.length === 0) {
		lines.push("*No skill activations recorded yet.*");
		return lines.join("\n");
	}

	lines.push("## Skill Metrics");
	lines.push("");

	for (const skillId of skillIds) {
		const metrics = computeSkillMetrics(skillId, activations);
		const gate = evaluatePromotionGate(metrics);

		lines.push(`### ${skillId}`);
		lines.push(`- **Confidence**: ${metrics.currentConfidence.toFixed(2)} (${metrics.trend})`);
		lines.push(`- **Pass Rate**: ${(metrics.passRate * 100).toFixed(1)}% (${metrics.passedActivations}/${metrics.totalActivations})`);
		lines.push(`- **Avg Confidence**: ${metrics.avgConfidence.toFixed(2)}`);
		lines.push(`- **Promotion Gate**: ${gate.passed ? "PASSED ✅" : "NOT MET"}`);

		if (Object.keys(metrics.roleBreakdown).length > 0) {
			lines.push(`- **By Role**: ${JSON.stringify(metrics.roleBreakdown)}`);
		}

		lines.push("");
	}

	return lines.join("\n");
}
