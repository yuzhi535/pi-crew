import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { padWithBackground, deriveCardBackground } from "../../src/ui/card-colors.ts";
import { cardMetricsLine } from "../../src/ui/tool-renderers/index.ts";
import type { CrewTheme } from "../../src/ui/theme-adapter.ts";

/**
 * ansi-box wiring into the live card system (Part A integration). Two real
 * changes are pinned here:
 *  1. padWithBackground now uses preserveBoxBackground → embedded resets inside
 *     content (syntax highlighting) no longer punch holes through the card bg.
 *  2. cardMetricsLine (new pi-pretty-style footer) → "· 1.2s · 4.2k tok".
 *
 * These are the VISIBLE+ROBUSTNESS improvements the UI overhaul ships.
 */

// Minimal CrewTheme mock: only the methods the helpers under test actually call.
// cardMetricsLine → theme.fg("dim", ...). padWithBackground/deriveCardBackground
// → theme.getFgAnsi/getBgAnsi (probed via as-unknown cast).
function mockTheme(fg = (s: string): string => s): CrewTheme {
	return {
		fg: (_color: string, text: string): string => text,
		bold: fg,
	} as unknown as CrewTheme;
}

// Theme that exposes getBgAnsi/getFgAnsi so deriveCardBackground can produce a bg.
function bgCapableTheme(): CrewTheme {
	return {
		fg: (_color: string, text: string): string => text,
		bold: (text: string): string => text,
		getFgAnsi: (): string => "\x1b[38;2;100;200;100m",
		getBgAnsi: (): string => "\x1b[48;2;20;20;30m",
	} as unknown as CrewTheme;
}

describe("padWithBackground — preserveBoxBackground integration", () => {
	it("neutralizes embedded full-resets so the card bg survives (the core fix)", () => {
		// Before the ansi-box wiring, a content line like "red\x1b[0m text" would
		// have its \x1b[0m punch through the bg fill, leaving "text" un-tinted.
		// Now preserveBoxBackground rewrites the content reset → RESET_WITHOUT_BG.
		// The ONLY raw \x1b[0m left is padWithBackground's intentional trailing
		// RESET (to clear the bg after the fill) — exactly one.
		const bg = "\x1b[48;2;30;30;40m";
		const out = padWithBackground("\x1b[31mred\x1b[0m more", 20, bg);
		assert.ok(out.startsWith(bg), "bg prefix applied");
		assert.ok(out.includes("22;23;24;25;27;28;29;39"), "content reset neutralized to RESET_WITHOUT_BG");
		const rawResets = (out.match(/\x1b\[0m/g) || []).length;
		assert.equal(rawResets, 1, "exactly one raw reset (the trailing RESET); content reset was neutralized");
	});

	it("strips competing bg codes from content (card bg wins)", () => {
		const bg = "\x1b[48;2;30;30;40m";
		// Content trying to set its own bg (48;2;...) must be stripped so the card
		// bg fill is the only background.
		const out = padWithBackground("text\x1b[48;2;99;0;0minner", 20, bg);
		assert.ok(!out.includes("48;2;99;0;0"), "competing content bg stripped");
	});

	it("keeps foreground colors in the content", () => {
		const bg = "\x1b[48;2;30;30;40m";
		const out = padWithBackground("\x1b[32mgreen\x1b[0m", 10, bg);
		assert.ok(out.includes("\x1b[32m"), "fg green preserved through preserveBoxBackground");
	});

	it("plain text (no SGR) is unaffected — padded + bg applied", () => {
		const bg = "\x1b[48;2;30;30;40m";
		const out = padWithBackground("hello", 10, bg);
		assert.ok(out.startsWith(bg));
		assert.ok(out.includes("hello"));
		// Padded to width 10: "hello" + 5 spaces, then RESET.
		assert.ok(out.endsWith("\x1b[0m"));
	});

	it("no-op path (empty bg) still pads without preserve rewrite side-effects", () => {
		const out = padWithBackground("\x1b[31mred\x1b[0m", 10, "");
		// No bg → no rewrite needed; content preserved as-is.
		assert.ok(out.includes("\x1b[31m"));
	});
});

describe("cardMetricsLine — pi-pretty-style footer", () => {
	it("formats elapsed + tokens as '· 1.2s · 4.2k tok'", () => {
		const theme = mockTheme();
		const line = cardMetricsLine(theme, { elapsedMs: 1200, tokens: 4200 });
		assert.match(line, /· 1\.2s/);
		assert.match(line, /4\.2k tok/);
	});

	it("formats ms durations", () => {
		const line = cardMetricsLine(mockTheme(), { elapsedMs: 500, tokens: 100 });
		assert.match(line, /500ms/);
		assert.match(line, /100 tok/);
	});

	it("includes char count when provided (renderToolMetrics)", () => {
		const line = cardMetricsLine(mockTheme(), { elapsedMs: 1000, charCount: 3000 });
		assert.match(line, /1\.0s/);
		assert.match(line, /3\.0k/); // char count
	});

	it("returns empty string when no metrics (caller skips)", () => {
		assert.equal(cardMetricsLine(mockTheme(), {}), "");
		assert.equal(cardMetricsLine(mockTheme(), { elapsedMs: 0, tokens: 0 }), "");
	});

	it("handles only-tokens (no elapsed)", () => {
		const line = cardMetricsLine(mockTheme(), { tokens: 50000 });
		assert.match(line, /50\.0k tok/);
		assert.ok(!line.includes("· ·"), "no double-separator when elapsed missing");
	});
});

describe("deriveCardBackground — still produces a bg for capable themes", () => {
	it("returns a 48;2 bg sequence when theme exposes fg ansi", () => {
		const bg = deriveCardBackground(bgCapableTheme(), "success");
		assert.ok(bg.startsWith("\x1b[48;2;"), "produces a truecolor bg");
	});

	it("returns '' for themes without fg ansi (graceful degradation)", () => {
		const bg = deriveCardBackground(mockTheme(), "success");
		assert.equal(bg, "", "no bg when theme can't derive one");
	});
});
