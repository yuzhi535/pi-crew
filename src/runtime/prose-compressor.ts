/**
 * Pure TypeScript prose compression module.
 *
 * Inspired by caveman's compress.js — reduces tool descriptions and other
 * prose by removing filler words, pleasantries, hedging, and articles while
 * preserving code, URLs, paths, identifiers, and other protected segments
 * byte-for-byte.
 *
 * No external dependencies. No `any` types. Regex-only pattern matching.
 */

// ---------------------------------------------------------------------------
// Protected segment patterns (order matters — earlier patterns take priority)
// ---------------------------------------------------------------------------

const PROTECTED_PATTERNS: readonly RegExp[] = [
	/```[\s\S]*?```/g,                                    // fenced code blocks
	/`[^`\n]+`/g,                                         // inline code
	/\bhttps?:\/\/\S+/gi,                                 // URLs
	/\b[\w.-]*[\/\\][\w.\/\\\-]+/g,                       // paths with / or \
	/\b[A-Z][A-Z0-9]*(?:_[A-Z][A-Z0-9]*)+\b/g,           // CONSTANT_CASE
	/\b\w+(?:\.\w+)+\(\)/g,                               // dotted.method() calls
	/[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\)/g,                // function calls: name(args)
	/\b\d+\.\d+\.\d+\b/g,                                 // version numbers x.y.z
];

// ---------------------------------------------------------------------------
// Compression patterns (applied to unprotected prose only)
// ---------------------------------------------------------------------------

const FILLERS = /\b(?:just|really|basically|actually|simply|quite|very|essentially|literally)\b/gi;

const PLEASANTRIES = /\b(?:please|kindly|thank you|thanks|sure|certainly|of course|happy to)\b[,.]?\s*/gi;

const HEDGES = /\b(?:perhaps|maybe|might|could potentially|would like to|i think|in my opinion)\b\s*/gi;

const LEADERS = /^(?:i'?\s*ll|i will|i can|you can|we will|we can|let me|let'?\s*s)\s+/gim;

const ARTICLES = /\b(?:a|an|the)\s+(?=[a-z])/gi;

// ---------------------------------------------------------------------------
// Sentinel helpers
// ---------------------------------------------------------------------------

const SENTINEL_OPEN = "\x00";
const SENTINEL_CLOSE = "\x00";
const SENTINEL_RE = /\x00(\d+)\x00/g;

interface SegmentStore {
	segments: string[];
}

function extractProtected(text: string, store: SegmentStore): string {
	let working = text;
	for (const re of PROTECTED_PATTERNS) {
		// Reset lastIndex for reused RegExp objects
		re.lastIndex = 0;
		working = working.replace(re, (match: string): string => {
			const index = store.segments.length;
			store.segments.push(match);
			return `${SENTINEL_OPEN}${index}${SENTINEL_CLOSE}`;
		});
	}
	return working;
}

function restoreProtected(text: string, store: SegmentStore): string {
	return text.replace(SENTINEL_RE, (_match: string, indexStr: string): string => {
		const index = Number(indexStr);
		return store.segments[index] ?? "";
	});
}

// ---------------------------------------------------------------------------
// Core prose compression
// ---------------------------------------------------------------------------

function compressProseText(text: string): string {
	let s = text;

	// Remove leading "I'll / I will / you can / ..." sentence openers
	s = s.replace(LEADERS, "");

	// Remove pleasantries
	s = s.replace(PLEASANTRIES, "");

	// Remove hedging phrases
	s = s.replace(HEDGES, "");

	// Remove filler adverbs
	s = s.replace(FILLERS, "");

	// Remove articles before lowercase words
	s = s.replace(ARTICLES, "");

	// Collapse whitespace introduced by removals
	s = s.replace(/[ \t]{2,}/g, " ");

	// Fix punctuation spacing (e.g. "word ," → "word,")
	s = s.replace(/\s+([,.;:!?])/g, "$1");

	// Collapse excessive newlines
	s = s.replace(/\n{3,}/g, "\n\n");

	// Re-capitalize first letter of each sentence after removals
	s = s.replace(/(^|[.!?]\s+)([a-z])/g, (_match: string, pre: string, ch: string): string => {
		return pre + ch.toUpperCase();
	});

	return s.trim();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CompressResult {
	compressed: string;
	originalLength: number;
	compressedLength: number;
	savingsPercent: number;
}

/**
 * Compress prose text by removing filler, pleasantries, hedging, and articles
 * while preserving code blocks, URLs, paths, identifiers, and other protected
 * segments byte-for-byte.
 */
export function compressProse(text: string): CompressResult {
	if (typeof text !== "string" || text.length === 0) {
		return {
			compressed: "",
			originalLength: 0,
			compressedLength: 0,
			savingsPercent: 0,
		};
	}

	const store: SegmentStore = { segments: [] };
	const extracted = extractProtected(text, store);
	const compressed = compressProseText(extracted);
	const restored = restoreProtected(compressed, store);

	const originalLength = text.length;
	const compressedLength = restored.length;
	const savingsPercent = originalLength > 0
		? Math.round(((originalLength - compressedLength) / originalLength) * 100 * 100) / 100
		: 0;

	return {
		compressed: restored,
		originalLength,
		compressedLength,
		savingsPercent,
	};
}

/**
 * Convenience wrapper — returns just the compressed string for tool
 * descriptions and other single-field use cases.
 */
export function compressToolDescription(description: string): string {
	return compressProse(description).compressed;
}
