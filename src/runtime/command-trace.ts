/**
 * T10 — Verbatim command-trace extraction from tool-call history.
 *
 * Ported from pi-agent-flow's `generateCommandsFromHistory` technique (see
 * `research-findings/pi-ecosystem-distillation.md` T10): workers routinely
 * PARAPHRASE commands in their self-reports ("I ran the tests" instead of the
 * exact `npm test -- --grep foo`). The orchestrator/user wants the VERBATIM
 * command trace. pi-crew already records each executed tool in
 * `CrewAgentProgress.recentTools` (capped at 25, args previewed at ≤240 chars),
 * so the factual trace is available — this module distills it.
 *
 * Design notes:
 *  - Reads only the recorded `{tool, args, endedAt}` tuples — never trusts any
 *    LLM-emitted command string. This is the whole point: mechanical, factual.
 *  - Recognizes bash/shell tools and extracts their `command` arg, sanitized to
 *    a single line (newlines → ⏎) so a multi-line script shows as one trace row.
 *  - Non-shell tools (write/edit/read) are counted but not inlined (their args
 *    are file paths, not commands; the task result already lists changed files).
 *  - Caps the returned command list to keep the status line / summary bounded.
 */

export interface ToolCallRecord {
	tool: string;
	args?: string;
	endedAt?: string;
}

export interface CommandTrace {
	/** Total number of recorded tool calls (all tool kinds). */
	totalTools: number;
	/** Count of recognized command-executing tools (bash/shell). */
	commandTools: number;
	/** Verbatim command strings (sanitized to one line), most-recent-last. */
	commands: string[];
	/** One-line summary suitable for a status/dashboard row, e.g. "cmd=8 (3 bash)". */
	summary: string;
}

const COMMAND_TOOL_NAMES = new Set(["bash", "shell", "execute_bash", "run_command", "terminal"]);
const MAX_COMMANDS = 12;
const MAX_COMMAND_LEN = 160;

/**
 * Extract a verbatim command trace from recorded tool calls. Pure function —
 * safe to call with any subset of recentTools. Returns an empty trace for
 * empty/missing input.
 */
export function extractCommandTrace(recentTools: readonly ToolCallRecord[] | undefined | null): CommandTrace {
	const tools = Array.isArray(recentTools) ? recentTools : [];
	// Only count well-formed records (string tool name) — malformed entries
	// are skipped entirely so a corrupt/transient record can't inflate totals.
	const valid = tools.filter((call) => call && typeof call.tool === "string");
	const totalTools = valid.length;
	const commands: string[] = [];
	let commandTools = 0;
	for (const call of valid) {
		const toolName = call.tool.toLowerCase();
		if (!COMMAND_TOOL_NAMES.has(toolName)) continue;
		commandTools += 1;
		const cmd = extractCommandArg(call.args);
		if (cmd) commands.push(sanitizeCommand(cmd));
	}
	const trimmed = commands.slice(-MAX_COMMANDS);
	return {
		totalTools,
		commandTools,
		commands: trimmed,
		summary: formatSummary(totalTools, commandTools),
	};
}

/** Pull the `command` field out of an args preview (JSON string or raw). */
function extractCommandArg(args: string | undefined): string | undefined {
	if (!args) return undefined;
	const raw = args.trim();
	if (!raw) return undefined;
	// Args is a JSON-stringified object like {"command":"ls -la"} (previewArgs
	// JSON.stringifies objects). Try to parse and read .command / .cmd.
	if (raw.startsWith("{")) {
		try {
			const parsed = JSON.parse(raw) as Record<string, unknown>;
			const cmd = parsed.command ?? parsed.cmd ?? parsed.script ?? parsed.input;
			if (typeof cmd === "string" && cmd.trim()) return cmd;
		} catch {
			// Not valid JSON — fall through to treat raw as the command.
		}
	}
	// Otherwise treat the whole preview as the command text.
	return raw;
}

/** Sanitize a command to a single bounded line for compact display. */
function sanitizeCommand(cmd: string): string {
	const oneLine = cmd.replace(/\s*\r?\n\s*/g, " ⏎ ").trim();
	if (oneLine.length <= MAX_COMMAND_LEN) return oneLine;
	return `${oneLine.slice(0, MAX_COMMAND_LEN - 1)}…`;
}

function formatSummary(totalTools: number, commandTools: number): string {
	if (totalTools === 0) return "";
	// "cmd=8" always; append "(3 bash)" only when there's a mix worth showing.
	if (commandTools === 0) return `cmd=${totalTools}`;
	if (commandTools === totalTools) return `cmd=${totalTools}`;
	return `cmd=${totalTools} (${commandTools} bash)`;
}
