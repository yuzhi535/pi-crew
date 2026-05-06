import type { AgentConfig, ResourceSource } from "../agents/agent-config.ts";
import { discoverAgents } from "../agents/discover-agents.ts";
import { discoverTeams } from "../teams/discover-teams.ts";
import { discoverWorkflows } from "../workflows/discover-workflows.ts";
import type { PiTeamsConfig } from "../config/config.ts";

export type CapabilityKind = "team" | "workflow" | "agent" | "skill" | "tool" | "runtime";
export type CapabilitySource = "builtin" | "project" | "user";
export type CapabilityState = "active" | "disabled" | "shadowed" | "missing";

export interface CapabilityItem {
	id: string;
	kind: CapabilityKind;
	name: string;
	description: string;
	source: CapabilitySource;
	path?: string;
	state: CapabilityState;
	disabledReason?: string;
	shadowedBy?: string;
}

function normalizeAgents(agents: AgentConfig[], source: CapabilitySource, disabledIds: Set<string>): CapabilityItem[] {
	return agents.map((agent) => {
		const id = `agent:${agent.name}`;
		const configDisabled = disabledIds.has(id);
		const agentDisabled = agent.disabled || configDisabled;
		return {
			id,
			kind: "agent" as const,
			name: agent.name,
			description: agent.description,
			source,
			path: agent.filePath,
			state: agentDisabled ? "disabled" : "active",
			disabledReason: configDisabled ? "disabled by policy" : agent.disabled ? "disabled in config" : undefined,
		};
	});
}

function normalizeTeams(cwd: string, disabledIds: Set<string>): CapabilityItem[] {
	const result = discoverTeams(cwd);
	return [...result.builtin, ...result.user, ...result.project].map((team) => {
		const id = `team:${team.name}`;
		const configDisabled = disabledIds.has(id);
		return {
			id,
			kind: "team" as const,
			name: team.name,
			description: team.description,
			source: team.source as CapabilitySource,
			path: team.filePath,
			state: configDisabled ? "disabled" : "active",
			disabledReason: configDisabled ? "disabled by policy" : undefined,
		};
	});
}

function normalizeWorkflows(cwd: string, disabledIds: Set<string>): CapabilityItem[] {
	const result = discoverWorkflows(cwd);
	return [...result.builtin, ...result.user, ...result.project].map((workflow) => {
		const id = `workflow:${workflow.name}`;
		const configDisabled = disabledIds.has(id);
		return {
			id,
			kind: "workflow" as const,
			name: workflow.name,
			description: workflow.description,
			source: workflow.source as CapabilitySource,
			path: workflow.filePath,
			state: configDisabled ? "disabled" : "active",
			disabledReason: configDisabled ? "disabled by policy" : undefined,
		};
	});
}

export function buildCapabilityInventory(cwd: string, config?: PiTeamsConfig): CapabilityItem[] {
	const disabledIds = new Set<string>(config?.policy?.disabledCapabilities ?? []);
	const agents = discoverAgents(cwd);
	return [
		...normalizeTeams(cwd, disabledIds),
		...normalizeWorkflows(cwd, disabledIds),
		...normalizeAgents([...agents.builtin, ...agents.user, ...agents.project], "builtin", disabledIds),
	].sort((a, b) => a.id.localeCompare(b.id));
}