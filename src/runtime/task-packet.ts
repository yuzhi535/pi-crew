import * as path from "node:path";
import type { TeamRunManifest, TaskPacket, TaskScope, VerificationContract } from "../state/types.ts";
import type { WorkflowStep } from "../workflows/workflow-config.ts";

// ═══════════════════════════════════════════════════════════════════════════
// SEC-007 Fix: Workflow Step Task Sanitization
// Context provided by workers comes from workflow definitions that could
// be user-controlled. Sanitize task text to prevent injection.
// See: SECURITY-ISSUES.md SEC-007
// ═══════════════════════════════════════════════════════════════════════════


/**
 * Sanitize workflow step task text to reduce injection risk.
 *
 * The task text is used as a prompt for worker agents. In a multi-tenant
 * or shared workflow scenario, malicious workflow definitions could
 * embed injection instructions.
 *
 * Sanitization:
 * - Strip zero-width Unicode characters
 * - Strip known prompt injection directive patterns
 * - Strip base64/hex encoded payloads
 * - Collapse excessive whitespace
 */
export function sanitizeTaskText(task: string): string {
	let sanitized = task;

	// 1. Strip zero-width and invisible Unicode characters
	sanitized = sanitized.replace(/[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/g, "");

	// 2. Strip known prompt injection directive patterns
	sanitized = sanitized.replace(
		/^\s*(?:SYSTEM|INSTRUCTION|IGNORE(?:\s+ALL)?\s+INSTRUCTIONS|OVERRIDE|YOUR\s+ROLE\s+IS|MALICIOUS)\s*:.*$/gim,
		""
	);

	// 3. Strip base64/hex encoded command payloads
	sanitized = sanitized.replace(/\b(?:base64|base32|hex)\s*['":]\s*([A-Za-z0-9+\/=]{16,})/gi, "[encoded-redacted]");

	// 4. Strip embedded instruction patterns in brackets
	sanitized = sanitized.replace(/\[(?:SYSTEM|INSTRUCTION|OVERRIDE)\s*:[^\]]*\]/gi, "");

	// 5. Collapse multiple blank lines
	sanitized = sanitized.replace(/\n{3,}/g, "\n\n");

	return sanitized.trim();
}

export interface BuildTaskPacketInput {
	manifest: TeamRunManifest;
	step: WorkflowStep;
	taskId: string;
	cwd: string;
	worktreePath?: string;
}

export interface TaskPacketValidationResult {
	valid: boolean;
	errors: string[];
}

export function inferTaskScope(step: WorkflowStep): TaskScope {
	const reads = step.reads === false ? [] : step.reads ?? [];
	if (reads.length === 1) return "single_file";
	if (reads.length > 1) return "module";
	return "workspace";
}

export function defaultVerificationContract(step: WorkflowStep): VerificationContract {
	return {
		requiredGreenLevel: step.verify ? "targeted" : "none",
		commands: [],
		allowManualEvidence: true,
	};
}

export function buildTaskPacket(input: BuildTaskPacketInput): TaskPacket {
	const scope = inferTaskScope(input.step);
	const reads = input.step.reads === false ? [] : input.step.reads ?? [];
	const scopePath = reads.length === 1 ? reads[0] : reads.length > 1 ? reads.join(", ") : undefined;
	// SEC-007: Sanitize task text before inserting into task packet
	const sanitizedTask = sanitizeTaskText(input.step.task);
	return {
		objective: sanitizedTask.replaceAll("{goal}", input.manifest.goal),
		scope,
		scopePath,
		repo: path.basename(input.manifest.cwd) || input.manifest.cwd,
		worktree: input.worktreePath,
		branchPolicy: input.manifest.workspaceMode === "worktree" ? "Use the assigned task worktree and avoid modifying the leader checkout." : "Use the current checkout; do not create branches unless explicitly requested.",
		acceptanceTests: [],
		commitPolicy: "Do not commit unless explicitly requested by the user or workflow.",
		reportingContract: "Report intended/changed files, verification evidence, blockers, conflict risks, and next recommended action.",
		escalationPolicy: "Stop and report if scope is ambiguous, destructive action is needed, permissions are missing, verification cannot be completed, or edits may overlap with another worker/task.",
		constraints: [
			"Stay within the assigned task scope.",
			"Do not claim completion without verification evidence.",
			"Use mailbox/API state for coordination when available.",
			"Do not make overlapping edits to the same file/symbol without explicit leader sequencing or ownership guidance.",
		],
		expectedArtifacts: ["prompt", "result", "verification"],
		verification: defaultVerificationContract(input.step),
	};
}

export function validateTaskPacket(packet: TaskPacket): TaskPacketValidationResult {
	const errors: string[] = [];
	if (!packet.objective.trim()) errors.push("objective must not be empty");
	if (!packet.repo.trim()) errors.push("repo must not be empty");
	if (!packet.branchPolicy.trim()) errors.push("branchPolicy must not be empty");
	if (!packet.commitPolicy.trim()) errors.push("commitPolicy must not be empty");
	if (!packet.reportingContract.trim()) errors.push("reportingContract must not be empty");
	if (!packet.escalationPolicy.trim()) errors.push("escalationPolicy must not be empty");
	if ((packet.scope === "module" || packet.scope === "single_file" || packet.scope === "custom") && !packet.scopePath?.trim()) {
		errors.push(`scopePath is required for scope '${packet.scope}'`);
	}
	if (packet.constraints.length === 0) errors.push("constraints must contain at least one entry");
	for (const [index, constraint] of packet.constraints.entries()) {
		if (!constraint.trim()) errors.push(`constraints contains an empty value at index ${index}`);
	}
	if (packet.expectedArtifacts.length === 0) errors.push("expectedArtifacts must contain at least one entry");
	for (const [index, artifact] of packet.expectedArtifacts.entries()) {
		if (!artifact.trim()) errors.push(`expectedArtifacts contains an empty value at index ${index}`);
	}
	for (const [index, test] of packet.acceptanceTests.entries()) {
		if (!test.trim()) errors.push(`acceptanceTests contains an empty value at index ${index}`);
	}
	return { valid: errors.length === 0, errors };
}

/**
 * Structured handoff template for task completion reports.
 * Distilled from ECC dmux-workflows pattern — workers use this format
 * so verifiers and downstream consumers can parse output predictably.
 */
export const HANDOFF_TEMPLATE = [
	"## Handoff",
	"",
	"### Summary",
	"<!-- 2-3 sentences describing what was done -->",
	"",
	"### Files Changed",
	"<!-- List each file changed with brief description -->",
	"<!-- - path/to/file.ts: description -->",
	"",
	"### Tests / Verification",
	"<!-- What tests pass? What was manually verified? -->",
	"",
	"### Follow-ups",
	"<!-- Any remaining issues or next steps -->",
].join("\n");

export function renderTaskPacket(packet: TaskPacket): string {
	return [
		"# Task Packet",
		"",
		"```json",
		JSON.stringify(packet, null, 2),
		"```",
		"",
	].join("\n");
}
