export type ResourceSource = "builtin" | "user" | "project" | "git";

export interface RoutingMetadata {
	triggers?: string[];
	useWhen?: string[];
	avoidWhen?: string[];
	cost?: "free" | "cheap" | "expensive";
	category?: string;
}

export interface AgentConfig {
	name: string;
	description: string;
	source: ResourceSource;
	filePath: string;
	systemPrompt: string;
	model?: string;
	fallbackModels?: string[];
	thinking?: string;
	tools?: string[];
	extensions?: string[];
	skills?: string[];
	systemPromptMode?: "replace" | "append";
	inheritProjectContext?: boolean;
	inheritSkills?: boolean;
	routing?: RoutingMetadata;
	memory?: "user" | "project" | "local";
	/** Tool loading strategy: "essential" = always load all tools, "lean" = only load tools in defaultTools list */
	loadMode?: "essential" | "lean";
	/** Explicit tool list when loadMode is "lean". null means all available tools. */
	defaultTools?: string[] | null;
	/** Context mode: "fresh" = clean start, "fork" = inherit parent session context */
	contextMode?: "fresh" | "fork";
	/** Maximum turns for this agent. Overrides runtime config if set. */
	maxTurns?: number;
	disabled?: boolean;
	override?: { source: "config"; path: string };
}
