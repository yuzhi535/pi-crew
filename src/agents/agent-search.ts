import type { AgentConfig } from "./agent-config.ts";

// ─── BM25 Agent Search ──────────────────────────────────────────────────────
// Lightweight BM25 search over agent descriptors for task-to-agent matching.
// Based on the same BM25 algorithm used in oh-my-pi's tool-index.ts.

export interface AgentSearchDocument {
	agent: AgentConfig;
	termFrequencies: Map<string, number>;
	length: number;
}

export interface AgentSearchIndex {
	documents: AgentSearchDocument[];
	averageLength: number;
	documentFrequencies: Map<string, number>;
}

export interface AgentSearchResult {
	agent: AgentConfig;
	score: number;
}

const BM25_K1 = 1.2;
const BM25_B = 0.75;
const FIELD_WEIGHTS = {
	name: 6,
	description: 2,
	role: 3,
} as const;

function tokenize(value: string): string[] {
	return value
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[^a-zA-Z0-9]+/g, " ")
		.toLowerCase()
		.trim()
		.split(/\s+/)
		.filter((token) => token.length > 0);
}

function addWeightedTokens(termFrequencies: Map<string, number>, value: string | undefined, weight: number): void {
	if (!value) return;
	for (const token of tokenize(value)) {
		termFrequencies.set(token, (termFrequencies.get(token) ?? 0) + weight);
	}
}

function buildAgentSearchDocument(agent: AgentConfig): AgentSearchDocument {
	const termFrequencies = new Map<string, number>();
	addWeightedTokens(termFrequencies, agent.name, FIELD_WEIGHTS.name);
	addWeightedTokens(termFrequencies, agent.description, FIELD_WEIGHTS.description);
	// Role from agent name heuristic
	const roleHint = agent.name?.replace(/[-_]/g, " ") ?? "";
	addWeightedTokens(termFrequencies, roleHint, FIELD_WEIGHTS.role);
	const length = Array.from(termFrequencies.values()).reduce((sum, value) => sum + value, 0);
	return { agent, termFrequencies, length };
}

export function buildAgentSearchIndex(agents: Iterable<AgentConfig>): AgentSearchIndex {
	const documents = Array.from(agents, buildAgentSearchDocument);
	const averageLength = documents.reduce((sum, document) => sum + document.length, 0) / documents.length || 1;
	const documentFrequencies = new Map<string, number>();
	for (const document of documents) {
		for (const token of new Set(document.termFrequencies.keys())) {
			documentFrequencies.set(token, (documentFrequencies.get(token) ?? 0) + 1);
		}
	}
	return { documents, averageLength, documentFrequencies };
}

export function searchAgents(index: AgentSearchIndex, query: string, limit: number): AgentSearchResult[] {
	const queryTokens = tokenize(query);
	if (queryTokens.length === 0) return [];
	if (index.documents.length === 0) return [];

	const queryTermCounts = new Map<string, number>();
	for (const token of queryTokens) {
		queryTermCounts.set(token, (queryTermCounts.get(token) ?? 0) + 1);
	}

	return index.documents
		.map((document) => {
			let score = 0;
			for (const [token, queryTermCount] of queryTermCounts) {
				const termFrequency = document.termFrequencies.get(token) ?? 0;
				if (termFrequency === 0) continue;
				const documentFrequency = index.documentFrequencies.get(token) ?? 0;
				const idf = Math.log(1 + (index.documents.length - documentFrequency + 0.5) / (documentFrequency + 0.5));
				const normalization = BM25_K1 * (1 - BM25_B + BM25_B * (document.length / index.averageLength));
				score += queryTermCount * idf * ((termFrequency * (BM25_K1 + 1)) / (termFrequency + normalization));
			}
			return { agent: document.agent, score };
		})
		.filter((result) => result.score > 0)
		.sort((left, right) => right.score - left.score || left.agent.name.localeCompare(right.agent.name))
		.slice(0, limit);
}
