import type { TeamTaskState, UsageState } from "./types.ts";

/**
 * Lifetime usage — accumulated via message_end events, survives compaction.
 * cacheRead is excluded because each turn's cacheRead is the cumulative cached
 * prefix re-read on that one call — summing across turns would count it N times.
 * See: https://github.com/nichekate/pi-subagents3/issues/38
 */
export type LifetimeUsage = { input: number; output: number; cacheWrite: number };

/** Sum of lifetime usage components, or 0 if undefined. */
export function getLifetimeTotal(u?: LifetimeUsage): number {
	return u ? u.input + u.output + u.cacheWrite : 0;
}

/** Add a usage delta into a target accumulator (mutates target). */
export function addUsage(into: LifetimeUsage, delta: LifetimeUsage): void {
	into.input += delta.input;
	into.output += delta.output;
	into.cacheWrite += delta.cacheWrite;
}

export function aggregateUsage(tasks: TeamTaskState[]): UsageState | undefined {
	const total: UsageState = {};
	let found = false;
	for (const task of tasks) {
		if (!task.usage) continue;
		found = true;
		total.input = (total.input ?? 0) + (task.usage.input ?? 0);
		total.output = (total.output ?? 0) + (task.usage.output ?? 0);
		total.cacheRead = (total.cacheRead ?? 0) + (task.usage.cacheRead ?? 0);
		total.cacheWrite = (total.cacheWrite ?? 0) + (task.usage.cacheWrite ?? 0);
		total.cost = (total.cost ?? 0) + (task.usage.cost ?? 0);
		total.turns = (total.turns ?? 0) + (task.usage.turns ?? 0);
	}
	return found ? total : undefined;
}

export function formatUsage(usage: UsageState | undefined): string {
	if (!usage) return "(none)";
	const parts: string[] = [];
	if (usage.input !== undefined) parts.push(`input=${usage.input}`);
	if (usage.output !== undefined) parts.push(`output=${usage.output}`);
	if (usage.cacheRead !== undefined) parts.push(`cacheRead=${usage.cacheRead}`);
	if (usage.cacheWrite !== undefined) parts.push(`cacheWrite=${usage.cacheWrite}`);
	if (usage.cost !== undefined && Number.isFinite(usage.cost)) parts.push(`cost=${usage.cost.toFixed(6)}`);
	if (usage.turns !== undefined) parts.push(`turns=${usage.turns}`);
	return parts.join(", ") || "(none)";
}
