/** A single Server-Sent Event */
export interface ServerSentEvent {
	event: string | null;
	data: string;
	raw: string[];
}

/** Read newline-delimited lines from a text ReadableStream, buffering partial chunks. */
async function* readLines(
	stream: ReadableStream<string>,
	signal?: AbortSignal,
): AsyncGenerator<string> {
	const reader = stream.getReader();
	let buffer = "";
	try {
		while (true) {
			if (signal?.aborted) return;
			const { done, value } = await reader.read();
			if (done) {
				if (buffer.length > 0) yield buffer;
				return;
			}
			buffer += value;
			let idx: number;
			while ((idx = buffer.indexOf("\n")) !== -1) {
				const line = buffer.endsWith("\r\n", idx + 1)
					? buffer.slice(0, idx - 1)
					: buffer.slice(0, idx);
				yield line;
				buffer = buffer.slice(idx + 1);
			}
		}
	} finally {
		reader.releaseLock();
	}
}

/** Parse SSE events from a byte stream */
export async function* readSseEvents(
	stream: ReadableStream<Uint8Array>,
	signal?: AbortSignal,
): AsyncGenerator<ServerSentEvent> {
	const textStream = stream.pipeThrough(new TextDecoderStream() as unknown as TransformStream<Uint8Array, string>);
	let currentEvent: string | null = null;
	let currentData: string[] = [];
	let currentRaw: string[] = [];

	function flush(): ServerSentEvent | null {
		if (currentData.length === 0 && currentEvent === null) return null;
		const evt: ServerSentEvent = {
			event: currentEvent,
			data: currentData.join("\n"),
			raw: currentRaw,
		};
		currentEvent = null;
		currentData = [];
		currentRaw = [];
		return evt;
	}

	for await (const line of readLines(textStream, signal)) {
		if (signal?.aborted) return;

		// Empty line → dispatch
		if (line === "") {
			const evt = flush();
			if (evt) yield evt;
			continue;
		}

		// Comment
		if (line.startsWith(":")) continue;

		// [DONE] sentinel
		if (line === "[DONE]") return;

		const colonIdx = line.indexOf(":");
		if (colonIdx === -1) {
			// Field with no value
			const field = line;
			if (field === "event") {
				currentEvent = "";
			} else if (field === "data") {
				currentData.push("");
			}
			currentRaw.push(line);
			continue;
		}

		const field = line.slice(0, colonIdx);
		let value = line.slice(colonIdx + 1);
		// Remove leading space after colon per SSE spec
		if (value.startsWith(" ")) value = value.slice(1);

		currentRaw.push(line);

		if (field === "event") {
			currentEvent = value;
		} else if (field === "data") {
			currentData.push(value);
		}
		// id / retry fields ignored
	}

	// Flush any remaining event at end of stream
	const evt = flush();
	if (evt) yield evt;
}

/** Parse SSE events and yield parsed JSON data objects */
export async function* readSseJson<T>(
	stream: ReadableStream<Uint8Array>,
	signal?: AbortSignal,
): AsyncGenerator<T> {
	for await (const evt of readSseEvents(stream, signal)) {
		try {
			const parsed: T = JSON.parse(evt.data) as T;
			yield parsed;
		} catch {
			// Skip non-JSON SSE data events (e.g., ping, error messages, sentinels)
			continue;
		}
	}
}
