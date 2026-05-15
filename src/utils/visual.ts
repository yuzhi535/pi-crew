export const ANSI_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;

const WIDTH_CACHE_LIMIT = 256;
const widthCache = new Map<string, number>();

/** Code-point ranges that render as width 2 in most terminals (CJK + emoji). */
const WIDE_RANGES: Array<[number, number]> = [
	// CJK Unified Ideographs
	[0x4E00, 0x9FFF],
	// CJK Extension A
	[0x3400, 0x4DBF],
	// CJK Compatibility Ideographs
	[0xF900, 0xFAFF],
	// Hangul Syllables
	[0xAC00, 0xD7AF],
	// CJK Symbols and Punctuation, Hiragana, Katakana
	[0x3000, 0x33FF],
	// Fullwidth forms
	[0xFF01, 0xFF60],
	// Emoji blocks
	// Emoji-presentation codepoints in 0x2600-0x27BF (narrow chars like ✓✗★ excluded)
	[0x2615, 0x2615], [0x2648, 0x2653], [0x267F, 0x267F], [0x2693, 0x2693],
	[0x26A1, 0x26A1], [0x26AA, 0x26AB], [0x26BD, 0x26BE], [0x26C4, 0x26C5],
	[0x26CE, 0x26CE], [0x26D4, 0x26D4], [0x26EA, 0x26EA], [0x26F2, 0x26F3],
	[0x26F5, 0x26F5], [0x26FA, 0x26FA], [0x26FD, 0x26FD], [0x2702, 0x2702],
	[0x2705, 0x2705], [0x2708, 0x270D], [0x270F, 0x270F], [0x2712, 0x2712],
	[0x2714, 0x2714], [0x2716, 0x2716], [0x271D, 0x271D], [0x2721, 0x2721],
	[0x2728, 0x2728], [0x2733, 0x2734], [0x2744, 0x2744], [0x2747, 0x2747],
	[0x274C, 0x274C], [0x274E, 0x274E], [0x2753, 0x2755], [0x2757, 0x2757],
	[0x2763, 0x2764], [0x2795, 0x2797], [0x27A1, 0x27A1], [0x27B0, 0x27B0],
	[0x27BF, 0x27BF],
	[0x1F300, 0x1F9FF], // Misc Symbols, Emoticons, Transport, Map, Supplement
	[0x1FA00, 0x1FAFF], // Symbols Extended-A
	[0x1F000, 0x1F02F], // Mahjong, Dominos
	[0xFE00, 0xFE0F],   // Variation Selectors (emoji presentation)
	[0x200D, 0x200D],   // Zero Width Joiner (creates compound emoji)
];

function isWideCodePoint(code: number): boolean {
	for (const [lo, hi] of WIDE_RANGES) {
		if (code >= lo && code <= hi) return true;
	}
	return false;
}

export function visibleWidth(value: string): number {
	// Skip caching for very long strings to avoid memory pressure.
	if (value.length > 4096) {
		let length = 0;
		for (const char of value.replace(ANSI_PATTERN, "")) {
			if (char !== "\n") length += isWideCodePoint(char.codePointAt(0) ?? 0) ? 2 : 1;
		}
		return length;
	}
	const cached = widthCache.get(value);
	if (cached !== undefined) return cached;
	let length = 0;
	for (const char of value.replace(ANSI_PATTERN, "")) {
		if (char !== "\n") length += isWideCodePoint(char.codePointAt(0) ?? 0) ? 2 : 1;
	}
	if (widthCache.size >= WIDTH_CACHE_LIMIT) {
		const firstKey = widthCache.keys().next().value;
		if (firstKey !== undefined) widthCache.delete(firstKey);
	}
	widthCache.set(value, length);
	return length;
}

export function __test__clearVisibleWidthCache(): void {
	widthCache.clear();
}

export function __test__visibleWidthCacheSize(): number {
	return widthCache.size;
}

function consumeAnsi(input: string, index: number): number {
	const char = input[index];
	if (!char || char !== "\u001b") return 0;
	if (input[index + 1] !== "[") return 0;
	let i = index + 2;
	while (i < input.length) {
		const code = input.charCodeAt(i);
		if (code >= 0x40 && code <= 0x7e) return i - index + 1;
		i++;
	}
	return 0;
}

function splitGraphemes(value: string): string[] {
	return Array.from(value.replace(ANSI_PATTERN, ""));
}

export function truncateToWidth(value: string, width: number, ellipsis = "…"): string {
	if (width <= 0) return "";
	if (visibleWidth(value) <= width) return value;
	if (width <= ellipsis.length) return ellipsis.slice(0, width);
	let output = "";
	let renderedWidth = 0;
	for (let i = 0; i < value.length; i++) {
		const ansiLen = consumeAnsi(value, i);
		if (ansiLen) {
			output += value.slice(i, i + ansiLen);
			i += ansiLen - 1;
			continue;
		}
		const char = value[i] as string;
		const nextIndex = ((char.codePointAt(0) ?? 0) > 0xFFFF) ? i + 2 : i + 1;
		const segment = value.slice(i, nextIndex);
		const charWidth = visibleWidth(segment);
		if (renderedWidth + charWidth > width - ellipsis.length) {
			return `${output}${ellipsis}`;
		}
		output += segment;
		renderedWidth += charWidth;
		i = nextIndex - 1;
	}
	return output;
}

export const truncate = truncateToWidth;

/**
 * Strip newlines and other terminal-confusing control characters from a
 * single-line label. Without this, embedded `\n`/`\r` in user-provided
 * text (run.goal, run.team, mailbox preview, agent activity, ...) breaks
 * box-drawing rows because the terminal advances to the next line in the
 * middle of a row, leaving the overlay's `│` border misaligned and the
 * dashboard appearing to "duplicate" itself below the original render.
 *
 * Preserves ANSI color/style escape sequences (\u001b[...m) which the
 * caller has already wrapped around the text via the theme adapter.
 */
export function sanitizeLine(value: string): string {
	if (!value) return "";
	let result = "";
	let i = 0;
	while (i < value.length) {
		const ansi = readAnsiCode(value, i);
		if (ansi) {
			result += ansi;
			i += ansi.length;
			continue;
		}
		const code = value.charCodeAt(i);
		// Replace any C0/C1 control char (incl. \n \r \t \v \f and 0x7F-0x9F)
		// with a single space; everything else is passed through verbatim.
		if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
			result += " ";
			i += 1;
			continue;
		}
		result += value[i];
		i += 1;
	}
	return result;
}

export function pad(value: string, width: number): string {
	const current = visibleWidth(value);
	if (current >= width) return value;
	return `${value}${" ".repeat(width - current)}`;
}

export function boxLine(text: string, innerWidth: number): string {
	return `│ ${truncate(text, innerWidth - 4)} │`;
}

function readAnsiCode(input: string, index: number): string | undefined {
	const ansiLength = consumeAnsi(input, index);
	if (ansiLength > 0) return input.slice(index, index + ansiLength);
	return undefined;
}

function takeCodePoint(input: string, index: number): { chunk: string; nextIndex: number } {
	const code = input.codePointAt(index);
	if (code === undefined) return { chunk: "", nextIndex: index + 1 };
	if (code >= 0xD800 && code <= 0xDBFF && index + 1 < input.length) {
		return { chunk: input.slice(index, index + 2), nextIndex: index + 2 };
	}
	return { chunk: input[index] ?? "", nextIndex: index + 1 };
}

export function wrapHard(value: string, width: number): string[] {
	if (width <= 0 || !value) return [];
	const lines: string[] = [];
	let current = "";
	let currentWidth = 0;
	let i = 0;
	while (i < value.length) {
		const ansi = readAnsiCode(value, i);
		if (ansi) {
			current += ansi;
			i += ansi.length;
			continue;
		}
		const { chunk, nextIndex } = takeCodePoint(value, i);
		const chunkWidth = visibleWidth(chunk);
		if (chunkWidth > width) {
			lines.push(current ? current + chunk : chunk);
			current = "";
			currentWidth = 0;
			i = nextIndex;
			continue;
		}
		if (currentWidth + chunkWidth > width) {
			if (current) lines.push(current);
			current = chunk;
			currentWidth = chunkWidth;
			i = nextIndex;
			continue;
		}
		current += chunk;
		currentWidth += chunkWidth;
		i = nextIndex;
	}
	if (current) lines.push(current);
	return lines.length > 0 ? lines : [""];
}

export interface VisualTruncateResult {
	visualLines: string[];
	skippedCount: number;
}

export function truncateToVisualLines(
	text: string,
	maxVisualLines: number,
	width: number,
	paddingX = 0,
): VisualTruncateResult {
	if (!text) {
		return { visualLines: [], skippedCount: 0 };
	}
	const effectiveWidth = Math.max(1, width - paddingX * 2);
	const limit = Math.max(1, maxVisualLines);
	const visualLines = text
		.split("\n")
		.flatMap((line) => wrapHard(pad(line, Math.max(0, effectiveWidth)).trimEnd(), effectiveWidth));
	if (visualLines.length <= limit) return { visualLines, skippedCount: 0 };
	const truncated = visualLines.slice(-limit);
	return { visualLines: truncated, skippedCount: visualLines.length - limit };
}
