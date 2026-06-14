/**
 * Syntax highlighting for pi-crew UI.
 *
 * Dual-strategy rendering (ported from pi-pretty's fire-and-forget pattern):
 *   1. SYNC: render plain text immediately (theme.fg on every line)
 *   2. ASYNC: Shiki highlights in background, invokes onHighlighted() to upgrade
 *
 * This gives users instant content, then it gets prettier — without blocking the
 * render call (Shiki's WASM highlighter is async and ~200-500ms cold start).
 *
 * Falls back to cli-highlight (sync) if Shiki is unavailable, and to plain text
 * if neither can handle the language.
 *
 * Contrast normalization (normalizeShikiContrast) rescues dark-on-dark Shiki
 * output: any fg color with luminance < 72 (perceptual) is replaced with a
 * muted gray so highlights stay readable on dark terminal backgrounds.
 */
import { supportsLanguage, highlight } from "cli-highlight";
import { bundledThemes } from "shiki";
import type { CrewTheme } from "./theme-adapter.ts";
import { asCrewTheme } from "./theme-adapter.ts";

// ── Optional Shiki integration (async, fire-and-forget) ─────────────────
// Loaded lazily so pi-crew works without @shikijs/cli installed.

type CodeToAnsiFn = (code: string, lang: string, theme: string) => Promise<string>;

let _codeToANSI: CodeToAnsiFn | null | undefined;
let _shikiLoadFailed = false;

async function loadShiki(): Promise<CodeToAnsiFn | null> {
	if (_shikiLoadFailed) return null;
	if (_codeToANSI !== undefined) return _codeToANSI;
	try {
		const mod = await import("@shikijs/cli");
		_codeToANSI = (mod as unknown as { codeToANSI?: CodeToAnsiFn }).codeToANSI ?? null;
		return _codeToANSI;
	} catch {
		_shikiLoadFailed = true;
		_codeToANSI = null;
		return null;
	}
}

// Pre-warm Shiki at module load so the first real highlight is fast.
void loadShiki();

// ── Theme resolution ────────────────────────────────────────────────────
// Pi theme names (e.g. "crew-dark", "catppuccin-mocha") are NOT the same as
// Shiki theme names (e.g. "github-dark", "catppuccin-mocha"). We validate
// against Shiki's bundledThemes registry and fall back to a sensible default
// so highlighting always works regardless of which Pi theme is active.

const DEFAULT_SHIKI_THEME = "github-dark";
export { DEFAULT_SHIKI_THEME };
const FG_MUTED_FALLBACK = "\x1b[38;2;139;148;158m";

/** Map common Pi/theme names to Shiki bundled theme names. */
export const THEME_ALIASES: Record<string, string> = {
	"dark": "github-dark",
	"light": "github-light",
	"crew-dark": "github-dark",
	"github-dark": "github-dark",
	"github-light": "github-light",
	"catppuccin-mocha": "catppuccin-mocha",
	"catppuccin-macchiato": "catppuccin-macchiato",
	"catppuccin-frappe": "catppuccin-frappe",
	"catppuccin-latte": "catppuccin-latte",
	"dracula": "dracula",
	"nord": "nord",
	"tokyo-night": "tokyo-night",
	"one-dark": "one-dark-pro",
	"material": "material-theme",
	"solarized": "solarized-dark",
};

/** Validate that a theme name is a real Shiki bundled theme. */
export function isValidShikiTheme(name: string): boolean {
	return Object.prototype.hasOwnProperty.call(bundledThemes, name);
}

function resolveShikiTheme(): string {
	// 1. Explicit override via env var (highest priority).
	const env = process.env.CREW_SHIKI_THEME;
	if (env) {
		return isValidShikiTheme(env) ? env : DEFAULT_SHIKI_THEME;
	}
	// 2. pi-crew config `ui.shikiTheme` override.
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const pathMod = require("node:path");
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const fsMod = require("node:fs");
		// Resolve pi-crew config: try CWD then home.
		const { loadConfig } = require("../config/config.ts");
		const cwd = process.cwd();
		const loaded = loadConfig(cwd);
		const uiConfig = (loaded.config as { ui?: { shikiTheme?: string } }).ui;
		const cfgTheme = uiConfig?.shikiTheme;
		if (cfgTheme && isValidShikiTheme(cfgTheme)) return cfgTheme;
		void fsMod; void pathMod;
	} catch {
		// config not loadable in this context — fall through
	}
	// 3. Read Pi's settings.json theme, map to Shiki if possible.
	try {
		const home = process.env.HOME;
		if (!home) return DEFAULT_SHIKI_THEME;
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const fs = require("node:fs");
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const path = require("node:path");
		const settings = JSON.parse(fs.readFileSync(path.join(home, ".pi/agent/settings.json"), "utf8"));
		const piTheme = settings.theme as string | undefined;
		if (!piTheme) return DEFAULT_SHIKI_THEME;
		// Try alias map first, then direct validation, then fallback.
		const aliased = THEME_ALIASES[piTheme.toLowerCase()];
		if (aliased && isValidShikiTheme(aliased)) return aliased;
		if (isValidShikiTheme(piTheme)) return piTheme;
		return DEFAULT_SHIKI_THEME;
	} catch {
		return DEFAULT_SHIKI_THEME;
	}
}

let SHIKI_THEME: string = resolveShikiTheme();

// ── Contrast normalization (ported from pi-pretty) ──────────────────────
// Shiki themes designed for white backgrounds (e.g. "github-light") produce
// dark fg colors that vanish on dark terminals. Detect by perceptual luminance
// and replace with a muted gray.

const ESC = "\u001b";
const ANSI_CAPTURE_RE = new RegExp(`${ESC}\\[([0-9;]*)m`, "g");

export function isLowContrastShikiFg(params: string): boolean {
	if (params === "30" || params === "90") return true; // black / bright black
	if (params === "38;5;0" || params === "38;5;8") return true;
	if (!params.startsWith("38;2;")) return false;
	const parts = params.split(";").map(Number);
	if (parts.length !== 5 || parts.some((n) => !Number.isFinite(n))) return false;
	const [, , r, g, b] = parts;
	// ITU-R BT.709 luminance — matches human perception for sRGB.
	const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
	return luminance < 72;
}

export function normalizeShikiContrast(ansi: string): string {
	return ansi.replace(ANSI_CAPTURE_RE, (seq, params: string) =>
		isLowContrastShikiFg(params) ? FG_MUTED_FALLBACK : seq,
	);
}

// ── Shiki cache (LRU) ───────────────────────────────────────────────────

const SHIKI_CACHE_LIMIT = 64;
const MAX_SHIKI_CHARS = 20_000; // skip huge files (slow + memory)
const _shikiCache = new Map<string, string>();

function touchShikiCache(key: string, val: string): string {
	_shikiCache.delete(key);
	_shikiCache.set(key, val);
	while (_shikiCache.size > SHIKI_CACHE_LIMIT) {
		const first = _shikiCache.keys().next().value;
		if (first === undefined) break;
		_shikiCache.delete(first);
	}
	return val;
}

async function hlShiki(code: string, language: string): Promise<string | null> {
	if (!code || code.length > MAX_SHIKI_CHARS) return null;
	const fn = await loadShiki();
	if (!fn) return null;
	const key = `${SHIKI_THEME}\0${language}\0${code}`;
	const hit = _shikiCache.get(key);
	if (hit !== undefined) return hit;
	try {
		const ansi = normalizeShikiContrast(await fn(code, language, SHIKI_THEME));
		const out = ansi.endsWith("\n") ? ansi.slice(0, -1) : ansi;
		return touchShikiCache(key, out);
	} catch {
		return null;
	}
}

// ── cli-highlight fallback (sync) ───────────────────────────────────────

function buildCliTheme(theme: CrewTheme): Record<string, (text: string) => string> {
	return {
		keyword: (text) => theme.fg("syntaxKeyword", text),
		built_in: (text) => theme.fg("syntaxType", text),
		literal: (text) => theme.fg("syntaxNumber", text),
		number: (text) => theme.fg("syntaxNumber", text),
		string: (text) => theme.fg("syntaxString", text),
		comment: (text) => theme.fg("syntaxComment", text),
		function: (text) => theme.fg("syntaxFunction", text),
		title: (text) => theme.fg("syntaxFunction", text),
		class: (text) => theme.fg("syntaxType", text),
		type: (text) => theme.fg("syntaxType", text),
		attr: (text) => theme.fg("syntaxVariable", text),
		variable: (text) => theme.fg("syntaxVariable", text),
		params: (text) => theme.fg("syntaxVariable", text),
		operator: (text) => theme.fg("syntaxOperator", text),
		punctuation: (text) => theme.fg("syntaxPunctuation", text),
	};
}

function hlCliSync(code: string, language: string | undefined, theme: CrewTheme): string {
	if (!language) {
		return code
			.split("\n")
			.map((line) => theme.fg("mdCodeBlock", line))
			.join("\n");
	}
	try {
		return highlight(code, {
			language,
			ignoreIllegals: true,
			theme: buildCliTheme(theme),
		}).trimEnd();
	} catch {
		return code
			.split("\n")
			.map((line) => theme.fg("mdCodeBlock", line))
			.join("\n");
	}
}

// ── Language detection ──────────────────────────────────────────────────

/** @internal */
function detectLanguageFromPath(filePath: string): string | undefined {
	const ext = filePath.split(".").pop()?.toLowerCase();
	if (!ext) return undefined;
	return languageMap[ext];
}

export const languageMap: Record<string, string> = {
	ts: "typescript",
	tsx: "typescript",
	js: "javascript",
	jsx: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	py: "python",
	md: "markdown",
	markdown: "markdown",
	json: "json",
	yml: "yaml",
	yaml: "yaml",
	toml: "yaml",
	html: "html",
	htm: "html",
	css: "css",
	scss: "scss",
	sass: "sass",
	bash: "bash",
	sh: "bash",
	zsh: "bash",
	fish: "bash",
	ps1: "powershell",
	sql: "sql",
	rust: "rust",
	rb: "ruby",
	go: "go",
	java: "java",
	kt: "kotlin",
	cpp: "cpp",
	cc: "cpp",
	cxx: "cpp",
	hpp: "cpp",
	c: "c",
	h: "c",
	cs: "csharp",
	php: "php",
};

// ── Public API (sync) ───────────────────────────────────────────────────
// These return immediately with sync-rendered content (cli-highlight or plain).
// Callers that want the async Shiki upgrade should use highlightCodeAsync().

export function highlightCode(code: string, language: string | undefined, themeLike: unknown = undefined): string {
	const theme = asCrewTheme(themeLike);
	const validLanguage = language && supportsLanguage(language) ? language : undefined;
	return hlCliSync(code, validLanguage, theme);
}

export function highlightJson(payload: string, themeLike: unknown = undefined): string {
	const theme = asCrewTheme(themeLike);
	try {
		return highlight(payload, {
			language: "json",
			ignoreIllegals: true,
			theme: buildCliTheme(theme),
		}).trimEnd();
	} catch {
		try {
			const parsed = JSON.parse(payload);
			return JSON.stringify(parsed, null, 2)
				.split("\n")
				.map((line) => theme.fg("mdCodeBlock", line))
				.join("\n");
		} catch {
			return payload
				.split("\n")
				.map((line) => theme.fg("mdCodeBlock", line))
				.join("\n");
		}
	}
}

// ── Public API (async with Shiki upgrade) ───────────────────────────────

export interface HighlightOptions {
	/** Path or filename to detect language from extension. */
	filePath?: string;
	/** Explicit language (overrides filePath detection). */
	language?: string;
	/** Called once with sync-rendered content (immediate). */
	onSync?: (text: string) => void;
	/** Called later with Shiki-highlighted content (async upgrade), if available. */
	onHighlighted?: (text: string) => void;
}

/**
 * Highlight code with a two-phase strategy:
 *   1. Immediately invoke onSync() with cli-highlight (or plain) output.
 *   2. Kick off Shiki in the background; if it succeeds, invoke onHighlighted()
 *      with the upgraded output. If Shiki is unavailable or fails, the sync
 *      output stands.
 *
 * Both callbacks receive the FULL highlighted text. Callers should use the
 * returned sync text for initial render, then swap in onHighlighted's text
 * when it arrives (e.g. via component.setText()).
 */
export async function highlightCodeAsync(
	code: string,
	options: HighlightOptions = {},
	themeLike: unknown = undefined,
): Promise<string> {
	const theme = asCrewTheme(themeLike);
	const language =
		options.language ??
		(options.filePath ? detectLanguageFromPath(options.filePath) : undefined);

	// Phase 1: sync render (cli-highlight or plain).
	const syncText = hlCliSync(code, language, theme);
	options.onSync?.(syncText);

	// Phase 2: async Shiki upgrade (fire-and-forget, but we also return it).
	if (language) {
		const shikiText = await hlShiki(code, language);
		if (shikiText !== null) {
			options.onHighlighted?.(shikiText);
			return shikiText;
		}
	}

	return syncText;
}

// ── Re-exports for callers that want raw Shiki access ────────────────────

export { detectLanguageFromPath };
