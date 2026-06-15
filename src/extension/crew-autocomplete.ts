/**
 * Crew editor autocomplete provider (Round 13 UX).
 *
 * Wraps Pi's built-in autocomplete provider and adds natural-language crew
 * phrase completion: when the user types `crew <prefix>` or `team <prefix>`
 * at the start of the input line, we suggest the matching phrases (e.g.
 * "crew status → /team-status"). This teaches users the natural-language
 * phrases that the input router (crew-input-router.ts) will rewrite on
 * submit — so they discover the feature without reading docs.
 *
 * For any non-crew input we delegate to the wrapped (`current`) provider, so
 * slash-command, file (`@`), and command-argument completion all keep working
 * unchanged.
 */
import type {
	AutocompleteItem,
	AutocompleteProvider,
	AutocompleteSuggestions,
} from "@earendil-works/pi-tui";
import { CREW_PHRASES } from "./crew-input-router.ts";

/** Max phrases to suggest. */
const MAX_PHRASES = 12;

/**
 * If the text before the cursor is a crew-natural-language trigger, return the
 * query word (the partial keyword after `crew `/`team `), or `undefined` when
 * it is not a crew trigger.
 *
 * Triggers look like `crew ` or `team ` optionally followed by a partial word
 * made of word characters, anchored at the start of the line.
 */
function extractCrewQuery(textBeforeCursor: string): string | undefined {
	// Anchor at start of line; require the `crew|team` keyword + whitespace,
	// then an optional partial word. We do NOT trigger mid-word on the keyword
	// itself (e.g. "cre" alone is not a trigger) — the keyword must be complete.
	const match = textBeforeCursor.match(/^(?:crew|team)\s+([\w-]*)$/i);
	return match?.[1];
}

/** Filter the shared phrase list by a partial keyword prefix. */
export function suggestCrewPhrases(query: string): AutocompleteItem[] {
	const q = query.toLowerCase();
	// Phrases are keyed by their keyword after "crew "/"team " (or the bare
	// word for "teams"). Build a lookup keyword per phrase.
	const seen = new Set<string>();
	const items: AutocompleteItem[] = [];
	for (const entry of CREW_PHRASES) {
		// Derive the autocomplete keyword: for "crew status" → "status";
		// for "teams" → "teams".
		const parts = entry.phrase.split(/\s+/);
		const keyword = parts.length > 1 ? parts.slice(1).join(" ") : entry.phrase;
		if (seen.has(entry.phrase)) continue;
		if (q && !keyword.toLowerCase().startsWith(q)) continue;
		seen.add(entry.phrase);
		items.push({
			value: entry.phrase,
			label: entry.phrase,
			description: `→ ${entry.command}`,
		});
		if (items.length >= MAX_PHRASES) break;
	}
	return items;
}

/**
 * Create a crew autocomplete provider that wraps `current`. When the input is
 * a crew natural-language trigger, returns phrase suggestions; otherwise
 * delegates to `current`.
 */
export function createCrewAutocompleteProvider(
	current: AutocompleteProvider,
): AutocompleteProvider {
	return {
		async getSuggestions(
			lines: string[],
			cursorLine: number,
			cursorCol: number,
			options: { signal: AbortSignal; force?: boolean },
		): Promise<AutocompleteSuggestions | null> {
			// Only trigger on the first line (Pi's main input is single-line;
			// multiline editors are out of scope and would surprise the user).
			if (cursorLine === 0) {
				const currentLine = lines[cursorLine] ?? "";
				const before = currentLine.slice(0, cursorCol);
				const query = extractCrewQuery(before);
				if (query !== undefined) {
					const items = suggestCrewPhrases(query);
					if (items.length > 0) {
						// prefix = the full text to replace (e.g. "crew st").
						// The default applyCompletion replaces the trailing
						// `prefix`-length chars with item.value.
						return { items, prefix: before };
					}
					// Triggered but no matches — return empty rather than
					// falling through to file/command completion, so the user
					// doesn't get a confusing file list while typing a phrase.
					return { items: [], prefix: before };
				}
			}
			return current.getSuggestions(lines, cursorLine, cursorCol, options);
		},

		applyCompletion(
			lines: string[],
			cursorLine: number,
			cursorCol: number,
			item: AutocompleteItem,
			prefix: string,
		): { lines: string[]; cursorLine: number; cursorCol: number } {
			// Delegate to the wrapped provider. For a non-slash, non-@ prefix
			// the default applyCompletion replaces the trailing `prefix`-length
			// chars with item.value — which is exactly the full phrase. This
			// matches our prefix contract (prefix = full text to cursor).
			return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
		},

		shouldTriggerFileCompletion(
			lines: string[],
			cursorLine: number,
			cursorCol: number,
		): boolean {
			// Suppress file-completion trigger inside a crew phrase so the
			// editor doesn't pop a file list over our phrase suggestions.
			if (cursorLine === 0) {
				const before = (lines[cursorLine] ?? "").slice(0, cursorCol);
				if (extractCrewQuery(before) !== undefined) return false;
			}
			return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
		},
	};
}

/** Register the crew autocomplete provider on a Pi UI context. Safe to call once. */
export function registerCrewAutocomplete(
	ctx: { ui?: { addAutocompleteProvider?: (factory: (current: AutocompleteProvider) => AutocompleteProvider) => void } },
): void {
	ctx.ui?.addAutocompleteProvider?.((current) => createCrewAutocompleteProvider(current));
}
