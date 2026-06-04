export interface EventBus {
	on(event: string, handler: (data: unknown) => void): () => void;
	emit(event: string, data: unknown): void;
}

export type RpcReply<T = void> =
	| { success: true; data?: T }
	| { success: false; error: string };

export const PROTOCOL_VERSION = 1;

export interface RpcDeps {
	events: EventBus;
	getCtx: () => unknown | undefined;
	spawn: (type: string, prompt: string, options?: Record<string, unknown>) => string;
	abort: (agentId: string) => boolean;
}

export interface RpcHandle {
	unsubPing: () => void;
	unsubSpawn: () => void;
	unsubStop: () => void;
}

function handleRpc<P extends { requestId: string }>(
	events: EventBus,
	channel: string,
	fn: (params: P) => unknown | Promise<unknown>,
): () => void {
	return events.on(channel, async (raw: unknown) => {
		const params = raw as P;
		// SECURITY: Validate requestId format to prevent channel injection.
		if (!/^[a-zA-Z0-9_-]+$/.test(params.requestId)) {
			throw new Error("Security: invalid requestId format");
		}
		try {
			const data = await fn(params);
			const reply: { success: true; data?: unknown } = { success: true };
			if (data !== undefined) reply.data = data;
			events.emit(`${channel}:reply:${params.requestId}`, reply);
		} catch (err: unknown) {
			events.emit(`${channel}:reply:${params.requestId}`, {
				success: false,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	});
}

export function registerCrewRpcHandlers(deps: RpcDeps): RpcHandle {
	const { events, getCtx, spawn, abort } = deps;

	const unsubPing = handleRpc(events, "crew:rpc:ping", () => {
		return { version: PROTOCOL_VERSION };
	});

	// SECURITY TRUST BOUNDARY: crew:rpc:spawn and crew:rpc:stop are privileged
	// operations that create or terminate child processes. Any subscriber on
	// the shared event bus can emit these events. In a multi-extension
	// environment, this means a malicious extension could spawn/stop agents.
	// Mitigation: validate that the caller is the pi-crew extension by checking
	// the request includes a known extension identifier. Log all invocations
	// for audit. A full fix requires event-bus-level origin signing.
	const CREW_RPC_SOURCE = "pi-crew";

	function validateRpcSource(params: { requestId: string; source?: string }): boolean {
		if (!params.source || params.source !== CREW_RPC_SOURCE) {
			console.warn(
				`[pi-crew SECURITY] RPC invocation from unexpected source: ${params.source ?? "(none)"}. ` +
				`Expected '${CREW_RPC_SOURCE}'. Request may be from an untrusted extension.`,
			);
			return false;
		}
		return true;
	}

	const unsubSpawn = handleRpc<{ requestId: string; type: string; prompt: string; options?: Record<string, unknown>; source?: string }>(
		events,
		"crew:rpc:spawn",
		(params) => {
			if (!validateRpcSource(params)) throw new Error("Unauthorized: RPC spawn requires source='pi-crew'");
			const ctx = getCtx();
			if (!ctx) throw new Error("No active session");
			return { id: spawn(params.type, params.prompt, params.options ?? {}) };
		},
	);

	const unsubStop = handleRpc<{ requestId: string; agentId: string; source?: string }>(
		events,
		"crew:rpc:stop",
		(params) => {
			if (!validateRpcSource(params)) throw new Error("Unauthorized: RPC stop requires source='pi-crew'");
			if (!abort(params.agentId)) throw new Error("Agent not found");
		},
	);

	return { unsubPing, unsubSpawn, unsubStop };
}
