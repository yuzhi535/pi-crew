import type { HookDefinition, HookName, HookContext, HookResult, HookExecutionReport } from "./types.ts";
import { appendEvent } from "../state/event-log.ts";
import type { TeamRunManifest } from "../state/types.ts";
import { runEventBus } from "../ui/run-event-bus.ts";

const registry = new Map<HookName, HookDefinition[]>();

// SECURITY: Hooks are currently global (registered once, applied to all workspaces).
// For multi-workspace environments, consider filtering hooks by workspace scope:
//   const workspaceHooks = getHooks(name).filter(h => !h.workspaceId || h.workspaceId === ctx.workspaceId);
// This prevents globally-registered hooks from operating on runs they weren't designed for.

export function registerHook(definition: HookDefinition): void {
	const hooks = registry.get(definition.name) ?? [];
	hooks.push(definition);
	registry.set(definition.name, hooks);
}

export function clearHooks(): void {
	registry.clear();
}

export function getHooks(name: HookName): HookDefinition[] {
	return registry.get(name) ?? [];
}

export async function executeHook(name: HookName, ctx: HookContext): Promise<HookExecutionReport> {
	const hooks = getHooks(name);
	if (hooks.length === 0) return { hookName: name, outcome: "allow", durationMs: 0 };
	// SECURITY: If ctx contains a workspaceId, filter hooks to only those scoped to
	// this workspace. This prevents globally-registered hooks from operating on runs
	// they weren't designed for.
	// SECURITY: Hooks without workspaceId match ALL workspaces. This is intentional
	// for globally-applicable hooks (e.g., logging, metrics). For multi-tenant
	// environments, all hooks should set workspaceId to prevent cross-workspace access.
	// TODO: Add a linter rule to detect hooks registered without workspaceId in multi-tenant deployments.
	const scopedHooks = hooks.filter((h) => h.workspaceId === undefined || h.workspaceId === null || h.workspaceId === ctx.workspaceId);
	if (scopedHooks.length === 0) return { hookName: name, outcome: "allow", durationMs: 0 };
	const POLLUTED_KEYS = new Set(["__proto__", "constructor", "prototype", "hasOwnProperty", "toString", "valueOf", "isPrototypeOf", "propertyIsEnumerable", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__"]);
	function sanitizeMergeData(data: Record<string, unknown>): Record<string, unknown> {
		const clean: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(data)) {
			if (!POLLUTED_KEYS.has(k.toLowerCase())) {
				if (v !== null && typeof v === "object" && !Array.isArray(v)) {
					clean[k] = sanitizeMergeData(v as Record<string, unknown>);
				} else {
					clean[k] = v;
				}
			}
		}
		return clean;
	}
	function sanitizeErrorMessage(message: string): string {
		// Remove file paths, environment variable references, and other potentially sensitive data
		return message
			.replace(/\/[^:\s]+/g, "[path]")
			.replace(/\b[A-Z_0-9]+\s*=/g, "[env]")
			.replace(/\b\d+\.\d+\.\d+\.\d+\b/g, "[ip]");
	}
	const start = Date.now();
	const diagnostics: string[] = [];
	let capturedModifications: Record<string, unknown> | undefined;
	for (const hook of scopedHooks) {
			try {
				const result: HookResult = await hook.handler(ctx);
				if (hook.mode === "blocking" && result.outcome === "block") {
					return { hookName: name, outcome: "block", durationMs: Date.now() - start, reason: result.reason };
				}
			if (result.outcome === "modify" && result.data) {
				Object.assign(ctx, sanitizeMergeData(result.data));
				capturedModifications = { ...result.data };
			}
		} catch (error) {
			const message = sanitizeErrorMessage(error instanceof Error ? error.message : String(error));
			if (hook.mode === "blocking") {
				return { hookName: name, outcome: "block", durationMs: Date.now() - start, reason: `Hook error: ${message}` };
			}
			// Non-blocking hook errors are accumulated as diagnostics; continue to next hook
			diagnostics.push(message);
			}
	}
	if (diagnostics.length > 0) {
		return { hookName: name, outcome: "diagnostic", durationMs: Date.now() - start, reason: diagnostics.join("; "), modifiedData: capturedModifications };
	}
	return { hookName: name, outcome: "allow", durationMs: Date.now() - start, modifiedData: capturedModifications };
}

export function appendHookEvent(manifest: TeamRunManifest, report: HookExecutionReport): void {
	appendEvent(manifest.eventsPath, {
		type: "hook.executed",
		runId: manifest.runId,
		message: `Hook ${report.hookName} completed with outcome=${report.outcome}${report.reason ? `: ${report.reason}` : ""}`,
		data: { hookName: report.hookName, outcome: report.outcome, durationMs: report.durationMs, reason: report.reason },
	});
	runEventBus.emit({ type: "effectiveness_changed", runId: manifest.runId, data: { hookName: report.hookName, outcome: report.outcome } });
}
