/**
 * Structural code summary — regex-based summarizer that elides function bodies,
 * long arrays, block comments, and import groups, keeping signatures.
 * Pure TypeScript fallback (no tree-sitter / Rust native dependency).
 */

// ── Public types ──

export interface SummarySegment {
	kind: "kept" | "elided";
	startLine: number;
	endLine: number;
	/** Verbatim text for kept segments; absent for elided */
	text?: string;
}

export interface SummaryResult {
	language: string | null;
	totalLines: number;
	elided: boolean;
	segments: SummarySegment[];
	rendered: string;
}

export interface SummaryOptions {
	minBodyLines?: number;    // default 4
	minCommentLines?: number; // default 6
}

// ── Language detection ──

const EXT_MAP: ReadonlyMap<string, string> = new Map([
	[".ts", "typescript"], [".tsx", "typescript"],
	[".js", "javascript"], [".jsx", "javascript"],
	[".mjs", "javascript"], [".cjs", "javascript"],
	[".py", "python"], [".rs", "rust"],
]);

export function detectLanguage(filePath: string): string | null {
	const dot = filePath.lastIndexOf(".");
	if (dot === -1) return null;
	return EXT_MAP.get(filePath.slice(dot).toLowerCase()) ?? null;
}

// ── Internal range helpers ──

interface Range { start: number; end: number; }

function mergeRanges(ranges: Range[]): Range[] {
	if (ranges.length === 0) return [];
	const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
	const merged: Range[] = [sorted[0]];
	for (let i = 1; i < sorted.length; i++) {
		const last = merged[merged.length - 1];
		if (sorted[i].start <= last.end + 1) last.end = Math.max(last.end, sorted[i].end);
		else merged.push({ ...sorted[i] });
	}
	return merged;
}

// ── Brace-based elision (TS/JS/Rust) ──
// NOTE: This is a regex heuristic, not a parser. Braces inside string literals,
// template strings, regex, and comments are counted, which can produce incorrect
// elision for edge cases like `const s = "{...}"` or `${expr}`. Acceptable for
// summaries; do not use for correctness-sensitive parsing.

function findBraceRanges(lines: string[], openPattern: RegExp, minBody: number): Range[] {
	const ranges: Range[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (!openPattern.test(lines[i])) continue;
		let depth = 0;
		let foundOpen = false;
		const start = i;
		for (let j = i; j < lines.length; j++) {
			for (const ch of lines[j]) {
				if (ch === "{") { depth++; foundOpen = true; }
				else if (ch === "}") { depth--; }
			}
			if (foundOpen && depth <= 0) {
				if (j - start - 1 >= minBody) ranges.push({ start: start + 1, end: j - 1 });
				break;
			}
		}
	}
	return ranges;
}

// ── TypeScript / JavaScript ──

const TS_FN_SIG =
	/^\s*(export\s+)?(async\s+)?function\s|^\s*(export\s+)?(static\s+|get\s+|set\s+|private\s+|public\s+|protected\s+|readonly\s+)*\*?\s*\w+\s*[\(<]/;
const TS_CLASS_SIG = /^\s*(export\s+)?(default\s+)?(abstract\s+)?class\s/;
const TS_STRUCT_SIG = /^\s*(export\s+)?(default\s+)?(const|let|var)\s+\w+\s*=\s*(\[[\s]*$|\{[\s]*$)/;

function tsRanges(lines: string[], minBody: number): Range[] {
	return [
		...findBraceRanges(lines, TS_FN_SIG, minBody),
		...findBraceRanges(lines, TS_CLASS_SIG, minBody),
		...findBraceRanges(lines, TS_STRUCT_SIG, minBody),
	];
}

// ── Block comments ──

function blockCommentRanges(lines: string[], minComment: number): Range[] {
	const ranges: Range[] = [];
	let i = 0;
	while (i < lines.length) {
		const idx = lines[i].indexOf("/*");
		if (idx === -1 || lines[i].includes("*/", idx + 2)) { i++; continue; }
		const openLine = i;
		let j = i + 1;
		while (j < lines.length && !lines[j].includes("*/")) j++;
		if (j < lines.length && j - openLine - 1 >= minComment)
			ranges.push({ start: openLine + 1, end: j - 1 });
		i = j + 1;
	}
	return ranges;
}

// ── Import groups ──

const IMPORT_RE = /^\s*import\s/;
const PY_IMPORT_RE = /^\s*(import\s|from\s+\S+\s+import\s)/;

function importGroupRanges(lines: string[], pattern: RegExp): Range[] {
	const groups: Array<{ start: number; end: number }> = [];
	let gs = -1, last = -1;
	for (let i = 0; i < lines.length; i++) {
		if (pattern.test(lines[i])) { if (gs === -1) gs = i; last = i; }
		else if (gs !== -1 && i > last) { groups.push({ start: gs, end: last }); gs = -1; last = -1; }
	}
	if (gs !== -1) groups.push({ start: gs, end: last });
	const ranges: Range[] = [];
	for (const g of groups) {
		if (g.end - g.start >= 2) ranges.push({ start: g.start + 1, end: g.end - 1 });
	}
	return ranges;
}

// ── Python ──

function pythonRanges(lines: string[], minBody: number): Range[] {
	const ranges: Range[] = [];
	for (let i = 0; i < lines.length; i++) {
		const m = /^(\s*)(async\s+)?def\s/.exec(lines[i]) || /^(\s*)class\s/.exec(lines[i]);
		if (!m) continue;
		const base = m[1].length;
		let bs = -1, be = -1;
		for (let j = i + 1; j < lines.length; j++) {
			if (lines[j].trim() === "") continue;
			const indent = lines[j].length - lines[j].trimStart().length;
			if (indent <= base) break;
			if (bs === -1) bs = j;
			be = j;
		}
		if (bs !== -1 && be - bs + 1 >= minBody) ranges.push({ start: bs, end: be });
	}
	ranges.push(...importGroupRanges(lines, PY_IMPORT_RE));
	return ranges;
}

// ── Rust ──

const RS_FN_SIG = /^\s*(pub\s+)?(async\s+)?(unsafe\s+)?fn\s/;
const RS_STRUCT_SIG = /^\s*(pub\s+)?struct\s+\w+.*\{$/;
const RS_ENUM_SIG = /^\s*(pub\s+)?enum\s+\w+.*\{$/;
const RS_MOD_SIG = /^\s*(pub\s+)?mod\s+\w+.*\{$/;

function rustRanges(lines: string[], minBody: number): Range[] {
	return [
		...findBraceRanges(lines, RS_FN_SIG, minBody),
		...findBraceRanges(lines, RS_STRUCT_SIG, minBody),
		...findBraceRanges(lines, RS_ENUM_SIG, minBody),
		...findBraceRanges(lines, RS_MOD_SIG, minBody),
	];
}

// ── Main entry ──

function fullResult(language: string | null, totalLines: number, code: string): SummaryResult {
	return {
		language, totalLines, elided: false,
		segments: [{ kind: "kept", startLine: 1, endLine: totalLines, text: code }],
		rendered: code,
	};
}

export function summarizeCode(
	code: string,
	language: string | null,
	options?: SummaryOptions,
): SummaryResult {
	const minBody = options?.minBodyLines ?? 4;
	const minComment = options?.minCommentLines ?? 6;

	if (!code || code.trim() === "") {
		return { language, totalLines: 0, elided: false, segments: [], rendered: "" };
	}

	const lines = code.split("\n");
	const totalLines = lines.length;

	if (!language) return fullResult(null, totalLines, code);

	const rawRanges: Range[] = [];
	switch (language) {
		case "typescript":
		case "javascript":
			rawRanges.push(...tsRanges(lines, minBody), ...blockCommentRanges(lines, minComment), ...importGroupRanges(lines, IMPORT_RE));
			break;
		case "python":
			rawRanges.push(...pythonRanges(lines, minBody));
			break;
		case "rust":
			rawRanges.push(...rustRanges(lines, minBody), ...blockCommentRanges(lines, minComment));
			break;
		default:
			return fullResult(language, totalLines, code);
	}

	const ranges = mergeRanges(rawRanges);
	if (ranges.length === 0) return fullResult(language, totalLines, code);

	// Build segments
	const segments: SummarySegment[] = [];
	let cursor = 0;
	for (const r of ranges) {
		if (cursor < r.start) {
			segments.push({ kind: "kept", startLine: cursor + 1, endLine: r.start, text: lines.slice(cursor, r.start).join("\n") });
		}
		segments.push({ kind: "elided", startLine: r.start + 1, endLine: r.end + 1 });
		cursor = r.end + 1;
	}
	if (cursor < totalLines) {
		segments.push({ kind: "kept", startLine: cursor + 1, endLine: totalLines, text: lines.slice(cursor).join("\n") });
	}

	// Render
	const parts: string[] = [];
	for (const seg of segments) {
		if (seg.kind === "kept") parts.push(seg.text ?? "");
		else parts.push(`  ... ${seg.endLine - seg.startLine + 1} lines elided ...`);
	}

	return { language, totalLines, elided: true, segments, rendered: parts.join("\n") };
}
