import type { TeamRunManifest, TeamTaskState, UsageState } from "../state/types.ts";

export interface LifetimeUsage {
	input: number;
	output: number;
	cacheWrite: number;
}

export function emptyLifetimeUsage(): LifetimeUsage {
	return { input: 0, output: 0, cacheWrite: 0 };
}

export function addUsage(into: LifetimeUsage, delta: { input?: number; output?: number; cacheWrite?: number }): void {
	if (typeof delta.input === "number") into.input += delta.input;
	if (typeof delta.output === "number") into.output += delta.output;
	if (typeof delta.cacheWrite === "number") into.cacheWrite += delta.cacheWrite;
}

export function lifetimeUsageFromState(state: UsageState | undefined): LifetimeUsage {
	if (!state) return emptyLifetimeUsage();
	return {
		input: state.input ?? 0,
		output: state.output ?? 0,
		cacheWrite: state.cacheWrite ?? 0,
	};
}

export function usageStateFromLifetime(lifetime: LifetimeUsage): UsageState {
	return {
		input: lifetime.input,
		output: lifetime.output,
		cacheWrite: lifetime.cacheWrite,
		cacheRead: 0,
	};
}

const taskUsageMap = new Map<string, LifetimeUsage>();

export function trackTaskUsage(taskId: string, delta: { input?: number; output?: number; cacheWrite?: number }): void {
	const existing = taskUsageMap.get(taskId) ?? emptyLifetimeUsage();
	addUsage(existing, delta);
	taskUsageMap.set(taskId, existing);
}

export function getTrackedTaskUsage(taskId: string): LifetimeUsage {
	return taskUsageMap.get(taskId) ?? emptyLifetimeUsage();
}

export function clearTrackedTaskUsage(taskId: string): void {
	taskUsageMap.delete(taskId);
}

export function clearAllTrackedTaskUsage(): void {
	taskUsageMap.clear();
}

export function aggregateTrackedUsageForRun(manifest: TeamRunManifest, tasks: TeamTaskState[]): UsageState {
	const total = emptyLifetimeUsage();
	for (const task of tasks) {
		const tracked = getTrackedTaskUsage(task.id);
		addUsage(total, tracked);
		// Also add any usage already stored on the task
		if (task.usage) addUsage(total, task.usage);
	}
	return usageStateFromLifetime(total);
}
