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
		try {
			const data = await fn(params);
			const reply: { success: true; data?: unknown } = { success: true };
			if (data !== undefined) reply.data = data;
			events.emit(`${channel}:reply:${params.requestId}`, reply);
		} catch (err: any) {
			events.emit(`${channel}:reply:${params.requestId}`, {
				success: false,
				error: err?.message ?? String(err),
			});
		}
	});
}

export function registerCrewRpcHandlers(deps: RpcDeps): RpcHandle {
	const { events, getCtx, spawn, abort } = deps;

	const unsubPing = handleRpc(events, "crew:rpc:ping", () => {
		return { version: PROTOCOL_VERSION };
	});

	const unsubSpawn = handleRpc<{ requestId: string; type: string; prompt: string; options?: Record<string, unknown> }>(
		events,
		"crew:rpc:spawn",
		({ type, prompt, options }) => {
			const ctx = getCtx();
			if (!ctx) throw new Error("No active session");
			return { id: spawn(type, prompt, options ?? {}) };
		},
	);

	const unsubStop = handleRpc<{ requestId: string; agentId: string }>(
		events,
		"crew:rpc:stop",
		({ agentId }) => {
			if (!abort(agentId)) throw new Error("Agent not found");
		},
	);

	return { unsubPing, unsubSpawn, unsubStop };
}
