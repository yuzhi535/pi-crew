import * as fs from "node:fs";
import * as path from "node:path";
import type { TeamRunManifest } from "../state/types.ts";

export interface StreamingOutputHandle {
	write(text: string): void;
	flush(): void;
	close(): void;
	getPath(): string;
}

export function createStreamingOutput(manifest: TeamRunManifest, taskId: string): StreamingOutputHandle {
	const outputDir = path.join(manifest.artifactsRoot, "streaming");
	fs.mkdirSync(outputDir, { recursive: true });
	const outputPath = path.join(outputDir, `${taskId}.md`);
	const stream = fs.createWriteStream(outputPath, { flags: "a", encoding: "utf-8" });
	let buffer = "";
	let closed = false;

	const flush = (): void => {
		if (closed || !buffer) return;
		try {
			stream.write(buffer);
			buffer = "";
		} catch {
			/* ignore write errors after close */
		}
	};

	const timer = setInterval(flush, 500);

	return {
		write(text: string) {
			if (closed) return;
			buffer += text;
			if (buffer.length > 4096) flush();
		},
		flush,
		close() {
			if (closed) return;
			closed = true;
			clearInterval(timer);
			flush();
			try { stream.end(); } catch { /* ignore */ }
		},
		getPath: () => outputPath,
	};
}

export function readStreamingOutput(manifest: TeamRunManifest, taskId: string): string {
	const outputPath = path.join(manifest.artifactsRoot, "streaming", `${taskId}.md`);
	if (!fs.existsSync(outputPath)) return "";
	try {
		return fs.readFileSync(outputPath, "utf-8");
	} catch {
		return "";
	}
}
