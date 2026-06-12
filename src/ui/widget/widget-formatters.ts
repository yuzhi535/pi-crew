/**
 * Widget formatting utilities.
 *
 * Extracted from crew-widget.ts for reuse and testability.
 */

import type { CrewAgentRecord } from "../../runtime/crew-agent-runtime.ts";
import type { LiveAgentHandle } from "../../runtime/live-agent-manager.ts";
import { getTaskUsage } from "../../runtime/usage-tracker.ts";

// ── Token formatting ──────────────────────────────────────────────────

export function formatTokensCompact(count: number): string {
	if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M tok`;
	if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k tok`;
	return `${count} tok`;
}

// ── Elapsed time ──────────────────────────────────────────────────────

export function elapsed(iso: string | undefined, now = Date.now()): string | undefined {
	if (!iso) return undefined;
	const ms = Math.max(0, now - new Date(iso).getTime());
	if (!Number.isFinite(ms)) return undefined;
	if (ms < 1000) return "now";
	if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
	if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
	return `${Math.floor(ms / 3_600_000)}h`;
}

// ── Agent activity description ────────────────────────────────────────

const TOOL_LABELS: Record<string, string> = {
	read: "reading",
	bash: "running command",
	edit: "editing",
	write: "writing",
	grep: "searching",
	find: "finding files",
	ls: "listing",
};

const TOOL_ICONS: Record<string, string> = {
	read: "📖",
	bash: ">",
	edit: "✏",
	write: "📝",
	grep: "🔍",
	find: "📁",
	ls: "📋",
	agent: "🤖",
};

export function describeLiveActivity(handle: LiveAgentHandle): string {
	const act = handle.activity;
	if (act.activeTools.size > 0) {
		const groups = new Map<string, number>();
		for (const toolName of act.activeTools.values()) {
			groups.set(toolName, (groups.get(toolName) ?? 0) + 1);
		}
		const parts: string[] = [];
		for (const [toolName, count] of groups) {
			const icon = TOOL_ICONS[toolName] ?? "?";
			const label = TOOL_LABELS[toolName] ?? toolName;
			if (count > 1) {
				parts.push(`${icon}${count} ${label}s`);
			} else {
				parts.push(`${icon} ${label}`);
			}
		}
		return parts.join(", ") + "…";
	}
	if (act.responseText?.trim()) {
		const line = act.responseText.split("\n").find((l) => l.trim())?.trim() ?? "";
		return line.length > 60 ? line.slice(0, 60) + "…" : line;
	}
	return "thinking…";
}

export function agentActivity(agent: CrewAgentRecord, liveHandle?: LiveAgentHandle): string {
	if (liveHandle && liveHandle.status === "running") {
		const live = describeLiveActivity(liveHandle);
		if (live === "thinking…" && agent.progress?.currentTool) return `${TOOL_LABELS[agent.progress.currentTool] ?? agent.progress.currentTool}…`;
		return live;
	}
	if (agent.progress?.currentTool) return `${TOOL_LABELS[agent.progress.currentTool] ?? agent.progress.currentTool}…`;
	const recent = agent.progress?.recentOutput?.at(-1);
	if (recent) {
		const cleaned = recent.replace(/\s+/g, " ").trim();
		return cleaned.length > 60 ? cleaned.slice(0, 60) + "…" : cleaned;
	}
	if (agent.progress?.activityState === "needs_attention") return "needs attention";
	if (agent.status === "queued") return "queued";
	if (agent.status === "running") {
		const age = agent.startedAt ? Date.now() - new Date(agent.startedAt).getTime() : Infinity;
		if (age < 5000 && !agent.progress?.currentTool) return "spawning…";
		return "thinking…";
	}
	if (agent.status === "failed") return agent.error ?? "failed";
	return "done";
}

// ── Agent stats line ──────────────────────────────────────────────────

export function agentStats(agent: CrewAgentRecord, liveHandle?: LiveAgentHandle): string {
	const parts: string[] = [];
	if (liveHandle) {
		const act = liveHandle.activity;
		if (act.toolUses > 0) parts.push(`${act.toolUses} tools`);
		const usage = getTaskUsage(liveHandle.taskId);
		const total = (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheWrite ?? 0);
		if (total > 0) parts.push(formatTokensCompact(total));
		try {
			const stats = liveHandle.session.getSessionStats?.();
			const ctxPct = stats?.contextUsage?.percent;
			if (ctxPct != null) parts.push(`${Math.round(ctxPct)}% ctx`);
		} catch { /* ignore */ }
		const rawStarted = act.startedAtMs || 0;
		const rawCompleted = act.completedAtMs || 0;
		const nowMs = Date.now();
		const toMs = (v: number): number => {
			if (v <= 0) return 0;
			if (v > 1000000000 && v < 10000000000) return v * 1000;
			if (v > 100000000000 && v < 10000000000000) return v;
			return v;
		};
		const startedMs = toMs(rawStarted);
		const completedMs = rawCompleted > 0 ? toMs(rawCompleted) : 0;
		const isValidStarted = startedMs > 0 && startedMs < nowMs + 60000 && startedMs > nowMs - 3155692600000;
		const ms = (completedMs > 0 && completedMs < nowMs + 60000 ? completedMs : nowMs) - (isValidStarted ? startedMs : nowMs);
		parts.push(`${(ms / 1000).toFixed(1)}s`);
	} else {
		if (agent.toolUses) parts.push(`${agent.toolUses} tools`);
		if (agent.progress?.tokens) parts.push(formatTokensCompact(agent.progress.tokens));
		const age = elapsed(agent.completedAt ?? agent.startedAt);
		if (age) parts.push(age);
	}
	return parts.join(" · ");
}

// ── Notification badge ────────────────────────────────────────────────

export function notificationBadge(count: number | undefined, env: NodeJS.ProcessEnv = process.env): string {
	if (!count || count <= 0) return "";
	const term = `${env.TERM ?? ""} ${env.WT_SESSION ?? ""} ${env.TERM_PROGRAM ?? ""}`.toLowerCase();
	const supportsEmoji = !term.includes("dumb") && env.NO_COLOR !== "1";
	return supportsEmoji ? ` 🔔${count}` : ` [!${count}]`;
}
