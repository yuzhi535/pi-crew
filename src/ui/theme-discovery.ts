/**
 * Theme discovery and selection.
 *
 * Exposes:
 *  - Pi UI theme discovery (builtins + custom ~/.pi/agent/themes/*.json)
 *  - Shiki code-highlight theme listing (grouped dark/light/other)
 *  - The active Pi theme + resolved Shiki theme
 *  - setPiTheme() to persist a choice in ~/.pi/agent/settings.json
 *
 * Wired into the `team-settings themes` / `theme` / `shiki` subcommands.
 */

import { bundledThemes } from "shiki";
import { THEME_ALIASES, DEFAULT_SHIKI_THEME, isValidShikiTheme } from "./syntax-highlight.ts";

// ---------------------------------------------------------------------------
// Pi UI themes
// ---------------------------------------------------------------------------

export interface PiThemeInfo {
	/** Theme name (filename stem or builtin id). */
	name: string;
	/** Where it comes from. */
	source: "builtin" | "custom";
	/** Absolute path to the .json file, if applicable. */
	path?: string;
	/** Human-friendly display name from the JSON `name` field, if present. */
	displayName?: string;
}

/** Builtin Pi themes shipped with the pi-coding-agent package. */
const BUILTIN_PI_THEMES = ["dark", "light"];

function customThemesDir(): string {
	const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
	return home ? `${home}/.pi/agent/themes` : "";
}

function settingsPath(): string {
	const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
	return home ? `${home}/.pi/agent/settings.json` : "";
}

/** Discover all available Pi UI themes (builtins + custom). */
export function discoverPiThemes(): PiThemeInfo[] {
	const out: PiThemeInfo[] = [];
	const seen = new Set<string>();

	// Builtins
	for (const name of BUILTIN_PI_THEMES) {
		if (seen.has(name)) continue;
		seen.add(name);
		out.push({ name, source: "builtin", displayName: name });
	}

	// Custom themes from ~/.pi/agent/themes/
	const dir = customThemesDir();
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const fs = require("node:fs");
		if (dir && fs.existsSync(dir)) {
			for (const file of fs.readdirSync(dir) as string[]) {
				if (!file.endsWith(".json")) continue;
				const name = file.slice(0, -5);
				if (seen.has(name)) continue;
				const fullPath = `${dir}/${file}`;
				let displayName: string | undefined;
				try {
					const json = JSON.parse(fs.readFileSync(fullPath, "utf8"));
					displayName = typeof json.name === "string" ? json.name : undefined;
				} catch {
					// keep undefined
				}
				seen.add(name);
				out.push({ name, source: "custom", path: fullPath, displayName });
			}
		}
	} catch {
		// directory unreadable — skip
	}

	return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Read the currently active Pi theme from ~/.pi/agent/settings.json. */
export function getActivePiTheme(): string | undefined {
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const fs = require("node:fs");
		const p = settingsPath();
		if (!p || !fs.existsSync(p)) return undefined;
		const json = JSON.parse(fs.readFileSync(p, "utf8"));
		return typeof json.theme === "string" ? json.theme : undefined;
	} catch {
		return undefined;
	}
}

/** Persist a Pi theme choice in ~/.pi/agent/settings.json. Returns the path or throws. */
export function setPiTheme(name: string): string {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const fs = require("node:fs");
	const p = settingsPath();
	if (!p) throw new Error("Could not determine settings path (no HOME).");
	let settings: Record<string, unknown> = {};
	try {
		if (fs.existsSync(p)) {
			settings = JSON.parse(fs.readFileSync(p, "utf8"));
		}
	} catch {
		// corrupt settings — start fresh
		settings = {};
	}
	settings.theme = name;
	fs.writeFileSync(p, JSON.stringify(settings, null, 2) + "\n", "utf8");
	return p;
}

// ---------------------------------------------------------------------------
// Shiki code-highlight themes
// ---------------------------------------------------------------------------

export interface ShikiThemeGroup {
	label: string;
	themes: string[];
}

/** All Shiki bundled theme names, grouped for display. */
export function listShikiThemesGrouped(): ShikiThemeGroup[] {
	const names = Object.keys(bundledThemes);
	const isLight = (t: string) => /light|day|one-light|snazzy|latte|dawn|lotus/.test(t);
	const isDark = (t: string) =>
		/dark|night|midnight|dracula|nord|pro|dim|synthwave|rose-pine|mocha|macchiato|frappe|wave|dragon|horizon|poimandres|vesper|plastic|red$|ochin|black$|aurora|laserwave|andromeeda|monokai|material|ocean|houston|mirage|plus|solarized-d|gruvbox-d|everforest-d|slack-d|min-d|vitesse-d/.test(
			t,
		);
	const dark = names.filter((t) => isDark(t) && !isLight(t)).sort();
	const light = names.filter((t) => isLight(t)).sort();
	const other = names.filter((t) => !dark.includes(t) && !light.includes(t)).sort();
	return [
		{ label: "Dark", themes: dark },
		{ label: "Light", themes: light },
		{ label: "Other / Colorful", themes: other },
	];
}

/** Map a Pi theme name to the Shiki theme it resolves to (via alias map). */
export function resolveShikiForPiTheme(piTheme: string | undefined): string {
	if (!piTheme) return DEFAULT_SHIKI_THEME;
	const aliased = THEME_ALIASES[piTheme.toLowerCase()];
	if (aliased && isValidShikiTheme(aliased)) return aliased;
	if (isValidShikiTheme(piTheme)) return piTheme;
	return DEFAULT_SHIKI_THEME;
}

// ---------------------------------------------------------------------------
// Formatted listing for `team-settings themes`
// ---------------------------------------------------------------------------

/**
 * Build the full formatted listing of all themes for display.
 * Shows Pi UI themes, Shiki code themes, the active selection, and switching instructions.
 */
export function formatThemesListing(): string {
	const piThemes = discoverPiThemes();
	const activePi = getActivePiTheme();
	const shikiGroups = listShikiThemesGrouped();
	const lines: string[] = [];

	lines.push("═══ Theme Gallery ═══");
	lines.push("");

	// ── Pi UI themes ──
	lines.push("Pi UI themes (overall terminal colors):");
	lines.push("");
	for (const t of piThemes) {
		const isActive = t.name === activePi;
		const tag = isActive ? " ← active" : "";
		const src = t.source === "custom" ? " (custom)" : " (builtin)";
		const disp = t.displayName && t.displayName !== t.name ? ` — ${t.displayName}` : "";
		lines.push(`  ${isActive ? "●" : "○"} ${t.name}${src}${disp}${tag}`);
	}
	lines.push("");
	lines.push("  Switch: team-settings theme <name>");
	lines.push("         (e.g. team-settings theme crew-dark)");
	lines.push("");

	// ── Shiki resolution ──
	const resolvedShiki = resolveShikiForPiTheme(activePi);
	lines.push("Shiki code-highlight theme (syntax colors in code blocks):");
	lines.push("");
	if (activePi) {
		lines.push(`  Current: Pi "${activePi}" → Shiki "${resolvedShiki}"`);
		const isAliased = THEME_ALIASES[activePi.toLowerCase()] !== undefined;
		if (!isAliased && activePi !== "dark" && activePi !== "light") {
			lines.push(`  (mapped via default fallback)`);
		}
	} else {
		lines.push(`  Current: default → Shiki "${resolvedShiki}"`);
	}
	lines.push("");
	lines.push("  Override: team-settings shiki <theme-name>");
	lines.push("");

	// ── Shiki theme list (grouped) ──
	for (const group of shikiGroups) {
		if (group.themes.length === 0) continue;
		lines.push(`  ${group.label} (${group.themes.length}):`);
		// Wrap into columns; long names wrap naturally to avoid padding overflow.
		const colWidth = 26;
		let line = "    ";
		for (let i = 0; i < group.themes.length; i++) {
			const t = group.themes[i];
			if (line.trimEnd().length - 4 + t.length > 76) {
				lines.push(line.trimEnd());
				line = "    ";
			}
			line += t.padEnd(colWidth);
		}
		if (line.trim().length) lines.push(line.trimEnd());
		lines.push("");
	}

	lines.push("Notes:");
	lines.push("  • Pi themes switch the whole TUI — restart Pi to apply.");
	lines.push("  • Shiki themes only affect code-block syntax colors.");
	lines.push("  • Shiki auto-resolves from your Pi theme; override only if desired.");
	lines.push(`  • Shiki bundle: ${shikiGroups.reduce((n, g) => n + g.themes.length, 0)} themes available.`);

	return lines.join("\n");
}
