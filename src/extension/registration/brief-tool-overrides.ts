/**
 * Brief tool overrides — re-registers built-in Pi tools with custom rendering.
 *
 * Inspired by oh-my-pi's pi-brief extension. Wraps each built-in tool
 * (read, bash, edit, write, find, grep, ls) keeping the original execute
 * but replacing renderCall/renderResult with themed, brief-aware versions.
 *
 * When brief mode is ON and tool result is collapsed (not expanded),
 * shows compact one-liners:
 *   read  → "→ 142 lines"
 *   bash  → "→ done" | "→ 12 lines"
 *   edit  → "→ edited +3 -1"
 *   write → "→ written"
 *   find  → "→ 5 files"
 *   grep  → "→ 3 matches"
 *   ls    → "→ 8 entries"
 */

import { homedir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { isBrief } from "../../ui/tool-renderers/brief-mode.ts";

// ── Path shortening ────────────────────────────────────────────────────

const HOME = homedir();
function shortenPath(p: string): string {
	if (p.startsWith(HOME)) return `~${p.slice(HOME.length)}`;
	return p;
}

// ── Text extraction ────────────────────────────────────────────────────

function fullText(result: { content: Array<{ type: string; text?: string }> }): string | undefined {
	const c = result.content.find((x): x is { type: "text"; text: string } => x.type === "text");
	return c?.text;
}

function fullRender(
	result: { content: Array<{ type: string; text?: string }> },
	theme: { fg: (slot: string, text: string) => string },
): Text {
	const text = fullText(result);
	if (!text) return new Text("", 0, 0);
	const lines = text
		.trim()
		.split("\n")
		.map((line) => theme.fg("toolOutput", line))
		.join("\n");
	return new Text(`\n${lines}`, 0, 0);
}

// ── Tool registration ──────────────────────────────────────────────────

export function registerBriefToolOverrides(pi: ExtensionAPI, cwd: string): void {
	const tools = {
		read: createReadTool(cwd),
		bash: createBashTool(cwd),
		edit: createEditTool(cwd),
		write: createWriteTool(cwd),
		find: createFindTool(cwd),
		grep: createGrepTool(cwd),
		ls: createLsTool(cwd),
	};

	// ─── Read ───
	pi.registerTool({
		name: "read",
		label: "read",
		description: tools.read.description,
		parameters: tools.read.parameters,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		async execute(toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any) {
			return tools.read.execute(toolCallId, params, signal, onUpdate);
		},
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		renderCall(args: any, theme: any): any {
			const p = shortenPath(args.path || "");
			const pathDisplay = p ? theme.fg("accent", p) : theme.fg("toolOutput", "...");
			let text = `${theme.fg("toolTitle", theme.bold("read"))} ${pathDisplay}`;
			if (args.offset !== undefined || args.limit !== undefined) {
				const startLine = args.offset ?? 1;
				const endLine = args.limit !== undefined ? startLine + args.limit - 1 : "";
				text += theme.fg("warning", `:${startLine}${endLine ? `-${endLine}` : ""}`);
			}
			return new Text(text, 0, 0);
		},
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		renderResult(result: any, options: any, theme: any): any {
			if (!isBrief() || options.expanded) return fullRender(result, theme);
			const text = fullText(result);
			if (!text) return new Text("", 0, 0);
			const count = text.trim().split("\n").filter(Boolean).length;
			if (count === 0) return new Text(theme.fg("dim", "→ empty"), 0, 0);
			return new Text(theme.fg("muted", `→ ${count} lines`), 0, 0);
		},
	});

	// ─── Bash ───
	pi.registerTool({
		name: "bash",
		label: "bash",
		description: tools.bash.description,
		parameters: tools.bash.parameters,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		async execute(toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any) {
			return tools.bash.execute(toolCallId, params, signal, onUpdate);
		},
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		renderCall(args: any, theme: any): any {
			const command = args.command || "...";
			const timeout = args.timeout as number | undefined;
			const timeoutSuffix = timeout ? theme.fg("muted", ` (${timeout}s)`) : "";
			return new Text(theme.fg("toolTitle", theme.bold(`$ ${command}`)) + timeoutSuffix, 0, 0);
		},
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		renderResult(result: any, options: any, theme: any): any {
			if (!isBrief() || options.expanded) return fullRender(result, theme);
			const text = fullText(result);
			if (!text) return new Text("", 0, 0);
			const trimmed = text.trim();
			if (!trimmed) return new Text(theme.fg("dim", "→ done"), 0, 0);
			const lines = trimmed.split("\n");
			if (lines.length === 1 && lines[0]!.length < 40) {
				return new Text(theme.fg("muted", `→ ${lines[0]}`), 0, 0);
			}
			return new Text(theme.fg("muted", `→ ${lines.length} lines`), 0, 0);
		},
	});

	// ─── Edit ───
	pi.registerTool({
		name: "edit",
		label: "edit",
		description: tools.edit.description,
		parameters: tools.edit.parameters,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		async execute(toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any) {
			return tools.edit.execute(toolCallId, params, signal, onUpdate);
		},
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		renderCall(args: any, theme: any): any {
			const p = shortenPath(args.path || "");
			const pathDisplay = p ? theme.fg("accent", p) : theme.fg("toolOutput", "...");
			return new Text(`${theme.fg("toolTitle", theme.bold("edit"))} ${pathDisplay}`, 0, 0);
		},
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		renderResult(result: any, options: any, theme: any): any {
			if (!isBrief() || options.expanded) return fullRender(result, theme);
			const text = fullText(result);
			if (!text) return new Text("", 0, 0);
			if (text.includes("Error") || text.includes("error")) {
				return new Text(theme.fg("error", "→ failed"), 0, 0);
			}
			const added = (text.match(/^\+ /gm) ?? []).length;
			const removed = (text.match(/^- /gm) ?? []).length;
			if (added === 0 && removed === 0) {
				return new Text(theme.fg("success", "→ edited"), 0, 0);
			}
			return new Text(
				theme.fg("success", "→ edited ") +
				theme.fg("toolDiffAdded", `+${added} `) +
				theme.fg("toolDiffRemoved", `-${removed}`),
				0, 0,
			);
		},
	});

	// ─── Write ───
	pi.registerTool({
		name: "write",
		label: "write",
		description: tools.write.description,
		parameters: tools.write.parameters,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		async execute(toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any) {
			return tools.write.execute(toolCallId, params, signal, onUpdate);
		},
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		renderCall(args: any, theme: any): any {
			const p = shortenPath(args.path || "");
			const pathDisplay = p ? theme.fg("accent", p) : theme.fg("toolOutput", "...");
			const lineCount = args.content ? String(args.content).split("\n").length : 0;
			const lineInfo = lineCount > 0 ? theme.fg("muted", ` (${lineCount} lines)`) : "";
			return new Text(`${theme.fg("toolTitle", theme.bold("write"))} ${pathDisplay}${lineInfo}`, 0, 0);
		},
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		renderResult(result: any, options: any, theme: any): any {
			if (!isBrief() || options.expanded) return fullRender(result, theme);
			const text = fullText(result);
			if (text) return new Text(theme.fg("error", `→ ${text}`), 0, 0);
			return new Text(theme.fg("success", "→ written"), 0, 0);
		},
	});

	// ─── Find ───
	pi.registerTool({
		name: "find",
		label: "find",
		description: tools.find.description,
		parameters: tools.find.parameters,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		async execute(toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any) {
			return tools.find.execute(toolCallId, params, signal, onUpdate);
		},
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		renderCall(args: any, theme: any): any {
			const pattern = args.pattern || "";
			const p = shortenPath(args.path || ".");
			let text = `${theme.fg("toolTitle", theme.bold("find"))} ${theme.fg("accent", pattern)}`;
			text += theme.fg("toolOutput", ` in ${p}`);
			return new Text(text, 0, 0);
		},
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		renderResult(result: any, options: any, theme: any): any {
			if (!isBrief() || options.expanded) return fullRender(result, theme);
			const text = fullText(result);
			if (!text) return new Text("", 0, 0);
			const count = text.trim().split("\n").filter(Boolean).length;
			if (count === 0) return new Text(theme.fg("dim", "→ none"), 0, 0);
			return new Text(theme.fg("muted", `→ ${count} files`), 0, 0);
		},
	});

	// ─── Grep ───
	pi.registerTool({
		name: "grep",
		label: "grep",
		description: tools.grep.description,
		parameters: tools.grep.parameters,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		async execute(toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any) {
			return tools.grep.execute(toolCallId, params, signal, onUpdate);
		},
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		renderCall(args: any, theme: any): any {
			const pattern = args.pattern || "";
			const p = shortenPath(args.path || ".");
			let text = `${theme.fg("toolTitle", theme.bold("grep"))} ${theme.fg("accent", `/${pattern}/`)}`;
			text += theme.fg("toolOutput", ` in ${p}`);
			return new Text(text, 0, 0);
		},
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		renderResult(result: any, options: any, theme: any): any {
			if (!isBrief() || options.expanded) return fullRender(result, theme);
			const text = fullText(result);
			if (!text) return new Text("", 0, 0);
			const count = text.trim().split("\n").filter(Boolean).length;
			if (count === 0) return new Text(theme.fg("dim", "→ none"), 0, 0);
			return new Text(theme.fg("muted", `→ ${count} matches`), 0, 0);
		},
	});

	// ─── Ls ───
	pi.registerTool({
		name: "ls",
		label: "ls",
		description: tools.ls.description,
		parameters: tools.ls.parameters,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		async execute(toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any) {
			return tools.ls.execute(toolCallId, params, signal, onUpdate);
		},
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		renderCall(args: any, theme: any): any {
			const p = shortenPath(args.path || ".");
			return new Text(`${theme.fg("toolTitle", theme.bold("ls"))} ${theme.fg("accent", p)}`, 0, 0);
		},
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		renderResult(result: any, options: any, theme: any): any {
			if (!isBrief() || options.expanded) return fullRender(result, theme);
			const text = fullText(result);
			if (!text) return new Text("", 0, 0);
			const count = text.trim().split("\n").filter(Boolean).length;
			if (count === 0) return new Text(theme.fg("dim", "→ empty"), 0, 0);
			return new Text(theme.fg("muted", `→ ${count} entries`), 0, 0);
		},
	});
}
