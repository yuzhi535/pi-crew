/**
 * Session-scoped state container.
 *
 * Generic Map keyed by session ID. Used by widget, dashboard, and
 * live-agent-manager to store per-session state without polluting globals.
 *
 * Inspired by @ayulab/pi-checkpoint SessionStateMap.
 */
export class SessionStateMap<T> {
	private readonly map = new Map<string, T>();

	getOrUndefined(sessionId: string): T | undefined {
		return this.map.get(sessionId);
	}

	get(sessionId: string): T | undefined {
		return this.map.get(sessionId);
	}

	set(sessionId: string, value: T): void {
		this.map.set(sessionId, value);
	}

	has(sessionId: string): boolean {
		return this.map.has(sessionId);
	}

	delete(sessionId: string): boolean {
		return this.map.delete(sessionId);
	}

	clear(): void {
		this.map.clear();
	}

	get size(): number {
		return this.map.size;
	}

	entries(): IterableIterator<[string, T]> {
		return this.map.entries();
	}

	values(): IterableIterator<T> {
		return this.map.values();
	}

	keys(): IterableIterator<string> {
		return this.map.keys();
	}
}
