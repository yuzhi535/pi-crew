export type CrewThemeColor =
	| "accent"
	| "border"
	| "borderAccent"
	| "borderMuted"
	| "success"
	| "error"
	| "warning"
	| "muted"
	| "dim"
	| "text"
	| "thinkingText"
	// Tool rendering
	| "toolTitle"
	| "toolOutput"
	| "toolDiffAdded"
	| "toolDiffRemoved"
	| "toolDiffContext"
	// Markdown
	| "mdHeading"
	| "mdLink"
	| "mdCode"
	| "mdCodeBlock"
	| "mdQuote"
	| "mdHr"
	| "mdListBullet"
	// Syntax highlighting
	| "syntaxKeyword"
	| "syntaxString"
	| "syntaxNumber"
	| "syntaxComment"
	| "syntaxFunction"
	| "syntaxVariable"
	| "syntaxType"
	| "syntaxOperator"
	| "syntaxPunctuation"
	// Message display
	| "userMessageText"
	| "customMessageLabel"
	// Thinking gradient (6 levels, low→high intensity)
	| "thinkingOff"
	| "thinkingMinimal"
	| "thinkingLow"
	| "thinkingMedium"
	| "thinkingHigh"
	| "thinkingXhigh"
	// Special
	| "bashMode";

export type CrewThemeBg =
	| "selectedBg"
	| "userMessageBg"
	| "customMessageBg"
	| "toolPendingBg"
	| "toolSuccessBg"
	| "toolErrorBg";

/** ANSI fallback values for theme color slots when the active theme doesn't define them. */
export const THEME_COLOR_FALLBACKS: Record<CrewThemeColor, string> = {
	accent: "\x1b[36m",
	border: "\x1b[38;5;240m",
	borderAccent: "\x1b[35m",
	borderMuted: "\x1b[38;5;236m",
	success: "\x1b[32m",
	error: "\x1b[31m",
	warning: "\x1b[33m",
	muted: "\x1b[38;5;245m",
	dim: "\x1b[38;5;240m",
	text: "\x1b[39m",
	thinkingText: "\x1b[38;5;245m",
	toolTitle: "\x1b[36m",
	toolOutput: "\x1b[38;5;245m",
	toolDiffAdded: "\x1b[32m",
	toolDiffRemoved: "\x1b[31m",
	toolDiffContext: "\x1b[38;5;245m",
	mdHeading: "\x1b[33m",
	mdLink: "\x1b[35m",
	mdCode: "\x1b[32m",
	mdCodeBlock: "\x1b[39m",
	mdQuote: "\x1b[38;5;245m",
	mdHr: "\x1b[38;5;240m",
	mdListBullet: "\x1b[36m",
	syntaxKeyword: "\x1b[35m",
	syntaxString: "\x1b[32m",
	syntaxNumber: "\x1b[33m",
	syntaxComment: "\x1b[38;5;245m",
	syntaxFunction: "\x1b[36m",
	syntaxVariable: "\x1b[39m",
	syntaxType: "\x1b[35m",
	syntaxOperator: "\x1b[35m",
	syntaxPunctuation: "\x1b[35m",
	userMessageText: "\x1b[39m",
	customMessageLabel: "\x1b[35m",
	thinkingOff: "\x1b[38;5;236m",
	thinkingMinimal: "\x1b[38;5;245m",
	thinkingLow: "\x1b[35m",
	thinkingMedium: "\x1b[35m",
	thinkingHigh: "\x1b[36m",
	thinkingXhigh: "\x1b[35m",
	bashMode: "\x1b[32m",
};

/** Map a thinking intensity level (0–5) to a theme color slot. */
export function thinkingColorForLevel(level: number): CrewThemeColor {
	const slots: CrewThemeColor[] = [
		"thinkingOff", "thinkingMinimal", "thinkingLow",
		"thinkingMedium", "thinkingHigh", "thinkingXhigh",
	];
	return slots[Math.min(Math.max(level, 0), 5)] ?? "thinkingOff";
}

export interface CrewTheme {
	fg(color: CrewThemeColor, text: string): string;
	bg?(color: CrewThemeBg, text: string): string;
	bold(text: string): string;
	italic?(text: string): string;
	underline?(text: string): string;
	inverse?(text: string): string;
}

function inverseAnsi(text: string): string {
	return `\u001b[7m${text}\u001b[27m`;
}

function safeNoopTheme(): CrewTheme {
	return {
		fg: (_color, text) => text,
		bold: (text) => text,
		inverse: inverseAnsi,
	};
}

function asStringFn(value: unknown, owner?: object): ((color: CrewThemeColor | CrewThemeBg, text: string) => string) | undefined {
	if (typeof value !== "function") return undefined;
	return (color: CrewThemeColor | CrewThemeBg, text: string) => {
		try {
			const fn = value as (this: object | undefined, color: CrewThemeColor | CrewThemeBg, text: string) => unknown;
			const result = fn.call(owner, color, text);
			return typeof result === "string" ? result : text;
		} catch {
			return text;
		}
	};
}

function asUnaryFn(value: unknown, owner?: object): ((text: string) => string) | undefined {
	if (typeof value !== "function") return undefined;
	return (text: string) => {
		try {
			const fn = value as (this: object | undefined, text: string) => unknown;
			const result = fn.call(owner, text);
			return typeof result === "string" ? result : text;
		} catch {
			return text;
		}
	};
}

function asInverse(value: unknown, owner?: object): (text: string) => string {
	return asUnaryFn(value, owner) ?? inverseAnsi;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function callMaybeString(fn: unknown): string | undefined {
	if (typeof fn !== "function") return undefined;
	try {
		const result = (fn as () => unknown)();
		return typeof result === "string" || typeof result === "number" || typeof result === "boolean" ? String(result) : undefined;
	} catch {
		return undefined;
	}
}

function themeSignature(theme: object): string {
	const record = theme as Record<string, unknown>;
	const primitiveEntries = Object.entries(record)
		.filter(([_key, value]) => value === undefined || value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean")
		.map(([key, value]) => `${key}:${String(value)}`)
		.sort();
	const colorMode = callMaybeString(record.getColorMode);
	return [colorMode ? `mode:${colorMode}` : undefined, ...primitiveEntries].filter((item): item is string => Boolean(item)).join("|");
}

type Unsubscribe = () => void;

interface ThemeSourceSubscription {
	callbacks: Set<() => void>;
	unsubscribeSource?: Unsubscribe;
	pollTimer?: ReturnType<typeof setInterval>;
	lastSignature: string;
}

const themeSubscriptions = new WeakMap<object, ThemeSourceSubscription>();

function asUnsubscribe(value: unknown): Unsubscribe | undefined {
	if (typeof value === "function") return value as Unsubscribe;
	const record = asRecord(value);
	if (!record) return undefined;
	if (typeof record.unsubscribe === "function") return () => (record.unsubscribe as () => void)();
	if (typeof record.dispose === "function") return () => (record.dispose as () => void)();
	return undefined;
}

function startThemeSourceSubscription(theme: object, subscription: ThemeSourceSubscription): void {
	const record = theme as Record<string, unknown>;
	const emit = () => {
		for (const callback of [...subscription.callbacks]) callback();
	};
	if (typeof record.onThemeChange === "function") {
		const result = (record.onThemeChange as (callback: () => void) => unknown)(emit);
		subscription.unsubscribeSource = asUnsubscribe(result);
		return;
	}
	if (typeof record.addEventListener === "function") {
		(record.addEventListener as (type: string, callback: () => void) => void)("change", emit);
		if (typeof record.removeEventListener === "function") {
			subscription.unsubscribeSource = () => (record.removeEventListener as (type: string, callback: () => void) => void)("change", emit);
		}
		return;
	}
	subscription.pollTimer = setInterval(() => {
		const nextSignature = themeSignature(theme);
		if (nextSignature === subscription.lastSignature) return;
		subscription.lastSignature = nextSignature;
		emit();
	}, 1000);
	subscription.pollTimer.unref();
}

export function subscribeThemeChange(theme: unknown, callback: () => void): () => void {
	if (!theme || typeof theme !== "object") return () => {};
	const key = theme;
	let subscription = themeSubscriptions.get(key);
	if (!subscription) {
		subscription = { callbacks: new Set(), lastSignature: themeSignature(key) };
		themeSubscriptions.set(key, subscription);
		startThemeSourceSubscription(key, subscription);
	}
	subscription.callbacks.add(callback);
	return () => {
		const current = themeSubscriptions.get(key);
		if (!current) return;
		current.callbacks.delete(callback);
		if (current.callbacks.size > 0) return;
		if (current.pollTimer) clearInterval(current.pollTimer);
		current.unsubscribeSource?.();
		themeSubscriptions.delete(key);
	};
}

export function asCrewTheme(raw: unknown): CrewTheme {
	const fallback = safeNoopTheme();
	if (!raw || typeof raw !== "object") return fallback;
	const record = raw as Record<string, unknown>;
	const fg = asStringFn(record.fg, raw);
	const bold = asUnaryFn(record.bold, raw);
	if (!fg || !bold) return fallback;
	return {
		fg,
		bg: asStringFn(record.bg, raw),
		bold,
		italic: asUnaryFn(record.italic, raw),
		underline: asUnaryFn(record.underline, raw),
		inverse: asInverse(record.inverse, raw),
	};
}
