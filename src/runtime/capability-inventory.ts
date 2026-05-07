import type { AgentConfig, ResourceSource } from "../agents/agent-config.ts";
import { discoverAgents } from "../agents/discover-agents.ts";
import { discoverTeams } from "../teams/discover-teams.ts";
import { discoverWorkflows } from "../workflows/discover-workflows.ts";
import { discoverSkills } from "../skills/discover-skills.ts";
import type { PiTeamsConfig } from "../config/config.ts";

export type CapabilityKind = "team" | "workflow" | "agent" | "skill" | "tool" | "runtime";
export type CapabilitySource = "builtin" | "project" | "user" | "package" | "git";
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

function normalizeSkills(cwd: string, disabledIds: Set<string>): CapabilityItem[] {
	const skills = discoverSkills(cwd);
	return skills.map((skill) => {
		const id = `skill:${skill.name}`;
		const configDisabled = disabledIds.has(id);
		return {
			id,
			kind: "skill" as const,
			name: skill.name,
			description: skill.description,
			source: skill.source as CapabilitySource,
			path: skill.path,
			state: configDisabled ? "disabled" : "active",
			disabledReason: configDisabled ? "disabled by policy" : undefined,
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
	const items = [
		...normalizeTeams(cwd, disabledIds),
		...normalizeWorkflows(cwd, disabledIds),
		...normalizeAgents([...agents.builtin, ...agents.user, ...agents.project], "builtin", disabledIds),
		...normalizeSkills(cwd, disabledIds),
	];

	// Mark shadowed resources: project/user items with same kind:name as a builtin
	const builtinNames = new Set(items.filter((item) => item.source === "builtin" || item.source === "package").map((item) => `${item.kind}:${item.name}`));
	for (const item of items) {
		if (item.source !== "builtin" && item.source !== "package" && builtinNames.has(`${item.kind}:${item.name}`)) {
			item.state = "shadowed";
			item.shadowedBy = `builtin:${item.kind}:${item.name}`;
		}
	}

	return items.sort((a, b) => a.id.localeCompare(b.id));
}
