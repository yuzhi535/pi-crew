/**
 * Task quality scoring — simple additive heuristic for evaluating task
 * completion quality based on diagnostics, metrics, artifacts, and duration.
 *
 * Distilled from pi-autoresearch's quality scoring pattern.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { TeamTaskState } from "../state/types.ts";

/** Letter grade for task quality. */
export type QualityGrade = "A" | "B" | "C" | "D";

/** Breakdown of individual quality criteria. */
export interface QualityBreakdown {
	/** Task has a non-empty diagnostics object. */
	hasDiagnostics: boolean;
	/** Task has a non-empty metrics object. */
	hasMetrics: boolean;
	/** Task produced files in the artifacts directory. */
	producedArtifacts: boolean;
	/** Task has a non-empty result/description. */
	hasDescription: boolean;
	/** Task duration is reasonable (> 0 and < 1 hour). */
	durationReasonable: boolean;
}

/** Scored quality result for a task. */
export interface TaskQualityScore {
	/** Numeric score (0–5). */
	score: number;
	/** Individual criterion breakdown. */
	breakdown: QualityBreakdown;
	/** Letter grade based on score thresholds. */
	grade: QualityGrade;
}

/** One hour in milliseconds. */
const ONE_HOUR_MS = 3_600_000;

/**
 * Determine the letter grade for a given numeric score.
 *
 * A: 4–5, B: 3, C: 2, D: 0–1
 */
function scoreToGrade(score: number): QualityGrade {
	if (score >= 4) return "A";
	if (score === 3) return "B";
	if (score === 2) return "C";
	return "D";
}

/**
 * Check whether the artifacts directory contains files for the given task.
 *
 * Looks for a subdirectory named after the task ID, or files containing
 * the task ID prefix in the artifacts directory.
 */
function hasTaskArtifacts(taskId: string, artifactsDir: string): boolean {
	try {
		if (!fs.existsSync(artifactsDir)) return false;

		// Check for a task-specific subdirectory
		const taskDir = path.join(artifactsDir, taskId);
		if (fs.existsSync(taskDir)) {
			const stat = fs.statSync(taskDir);
			if (stat.isDirectory()) {
				const entries = fs.readdirSync(taskDir);
				return entries.length > 0;
			}
		}

		// Check for files containing the task ID prefix
		const entries = fs.readdirSync(artifactsDir);
		const safePrefix = taskId.replace(/[^a-zA-Z0-9_-]/g, "");
		return entries.some((entry) => entry.includes(safePrefix));
	} catch {
		return false;
	}
}

/**
 * Check if a task result string is a non-empty description.
 *
 * A result is considered descriptive if any of these sources have non-empty content:
 * - task.resultArtifact exists with a path
 * - task.error is a non-empty string (workers often set this with result info)
 * - task.verification.satisfied is true
 * - task.diagnostics contains a 'result' string
 */
function isResultDescriptive(task: TeamTaskState): boolean {
	// Check resultArtifact — presence of a result artifact indicates output was produced
	if (task.resultArtifact?.path) return true;

	// Check error field — workers often put result info here
	if (typeof task.error === "string" && task.error.trim().length > 0) return true;

	// Check verification — satisfied verification indicates meaningful output
	if (task.verification?.satisfied) return true;

	// Check diagnostics for an explicit result string
	if (
		task.diagnostics &&
		typeof task.diagnostics === "object" &&
		typeof task.diagnostics.result === "string" &&
		(task.diagnostics.result as string).trim().length > 0
	) return true;

	return false;
}

/**
 * Check if the task duration is reasonable (started, finished, > 0, < 1 hour).
 */
function isDurationReasonable(task: TeamTaskState): boolean {
	if (!task.startedAt || !task.finishedAt) return false;

	const started = new Date(task.startedAt).getTime();
	const finished = new Date(task.finishedAt).getTime();

	if (Number.isNaN(started) || Number.isNaN(finished)) return false;

	const duration = finished - started;
	return duration > 0 && duration < ONE_HOUR_MS;
}

/**
 * Compute the quality score for a completed task.
 *
 * Uses simple additive scoring across 5 criteria:
 * - hasDiagnostics: +1 if task.diagnostics exists and has keys
 * - hasMetrics: +1 if task.metrics exists and has keys
 * - producedArtifacts: +1 if artifactsDir has files for this task
 * - hasDescription: +1 if task has a non-empty result/description
 * - durationReasonable: +1 if task has both startedAt and finishedAt, duration > 0 and < 1 hour
 *
 * @param task - The task state to evaluate
 * @param artifactsDir - Optional path to the run artifacts directory
 * @returns TaskQualityScore with numeric score, breakdown, and letter grade
 */
export function computeTaskQuality(
	task: TeamTaskState,
	artifactsDir?: string,
): TaskQualityScore {
	const hasDiagnostics =
		task.diagnostics !== undefined &&
		typeof task.diagnostics === "object" &&
		Object.keys(task.diagnostics).length > 0;

	const hasMetrics =
		task.metrics !== undefined &&
		typeof task.metrics === "object" &&
		Object.keys(task.metrics).length > 0;

	const producedArtifacts =
		artifactsDir !== undefined && hasTaskArtifacts(task.id, artifactsDir);

	const hasDescription = isResultDescriptive(task);

	const durationReasonable = isDurationReasonable(task);

	const breakdown: QualityBreakdown = {
		hasDiagnostics,
		hasMetrics,
		producedArtifacts,
		hasDescription,
		durationReasonable,
	};

	const score =
		(hasDiagnostics ? 1 : 0) +
		(hasMetrics ? 1 : 0) +
		(producedArtifacts ? 1 : 0) +
		(hasDescription ? 1 : 0) +
		(durationReasonable ? 1 : 0);

	return {
		score,
		breakdown,
		grade: scoreToGrade(score),
	};
}

/** Human-readable labels for each quality criterion. */
const CRITERION_LABELS: Record<keyof QualityBreakdown, string> = {
	hasDiagnostics: "diagnostics",
	hasMetrics: "metrics",
	producedArtifacts: "artifacts",
	hasDescription: "description",
	durationReasonable: "duration",
};

/**
 * Format a quality score as a human-readable one-line string.
 *
 * Format: "Quality: B (3/5: diagnostics, metrics, description)"
 *
 * @param score - The quality score to format
 * @returns Formatted string
 */
export function formatQualityScore(score: TaskQualityScore): string {
	const metCriteria = Object.entries(score.breakdown)
		.filter(([, met]) => met)
		.map(([key]) => CRITERION_LABELS[key as keyof QualityBreakdown]);

	return `Quality: ${score.grade} (${score.score}/5${metCriteria.length > 0 ? `: ${metCriteria.join(", ")}` : ""})`;
}
