/**
 * Safe Bash Tool for pi-crew
 * Wraps bash with dangerous command blocking
 */

import { Type } from "@sinclair/typebox";

// Dangerous command patterns to block
const DANGEROUS_PATTERNS = [
	// rm -rf / or rm -rf ~ (catastrophic root/home deletion)
	/\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s*)+(\/|~)(\s*$)/,
	/\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s*)+(\/|~)($|\s)/,
	// Privilege escalation
	/\bsudo\b/,
	/\bsu\s+root\b/,
	// Filesystem destruction
	/\bmkfs\b/,
	/\bdd\s+if=/,
	// Fork bomb
	/^:\s*\(\s*\)\s*\{.*\|.*&.*\}\s*;.*$/,
	// Device writing
	/>\s*\/dev\/[sh]d[a-z]/,
	/\bchmod\s+(-[a-zA-Z]+\s+)?777\s+\//,
	/\bchown\s+(-[a-zA-Z]+\s+)?root/,
	// Pipe to shell (download and execute)
	/\bcurl\s.*\|\s*(ba)?sh/i,
	/\bwget\s.*\|\s*(ba)?sh/i,
	// System shutdown/reboot
	/\bshutdown\b/,
	/\breboot\b/,
	/\binit\s+0\b/,
	// Kill critical processes
	/\bkill\s+-9\s+1\b/,
	/\bkillall\b/,
	// Encoded commands
	/\|\s*base64\s+-d/,
	/\|\s*python.*-c/,
	/\|\s*perl.*-e/,
	/\|\s*ruby.*-e/,
	// Network to shell
	/\bbash\s+-i\s+>\s*\&/,
	/\bexec\s+.*bash/,
	// /etc/passwd manipulation
	/\becho\s+.*>\s*\/etc\/passwd/,
	/\bcat\s+.*>\s*\/etc\/passwd/,
];

export interface SafeBashOptions {
	/** Enable/disable safe mode. Default: true */
	enabled?: boolean;
	/** Additional patterns to block */
	additionalPatterns?: RegExp[];
	/** Patterns to allow (overrides blocked) */
	allowPatterns?: RegExp[];
}

const DEFAULT_ENABLED = true;

/**
 * Check if a command is dangerous
 * @returns Error message if dangerous, null if safe
 */
export function isDangerous(command: string, options: SafeBashOptions = {}): string | null {
	const { enabled = DEFAULT_ENABLED, additionalPatterns = [], allowPatterns = [] } = options;

	if (!enabled) return null;

	// Normalize: remove line continuations, collapse whitespace
	const normalized = command.replace(/\\\n/g, " ").replace(/\s+/g, " ").trim();

	// Check allow patterns first (overrides)
	for (const pattern of allowPatterns) {
		if (pattern.test(normalized)) {
			return null; // Explicitly allowed
		}
	}

	// Check dangerous patterns
	const allPatterns = [...DANGEROUS_PATTERNS, ...additionalPatterns];
	for (const pattern of allPatterns) {
		if (pattern.test(normalized)) {
			return `Command blocked by safe_bash: matches dangerous pattern \`${pattern}\``;
		}
	}

	// Additional shell injection checks
	// Block command substitution $(...)
	if (/\$\([^)]*\)/.test(command)) {
		return "Command blocked by safe_bash: command substitution $(...) is not allowed";
	}
	// Block backtick substitution
	const backtickRe = /`[^`]*`/;
	if (backtickRe.test(command)) {
		return "Command blocked by safe_bash: backtick substitution is not allowed";
	}
	// Block here-docs <<
	if (/<<\s*['"]?[\w-]+['"]?/.test(command) || /\$<<\s*['"]?[\w-]+['"]?/.test(command)) {
		return "Command blocked by safe_bash: here-doc is not allowed";
	}
	// Block ${...} variable expansion containing shell metacharacters (pipes, redirects, &&/||)
	const varExpRe = /\$\{([^}]*)\}/;
	const varMatch = command.match(varExpRe);
	if (varMatch && /[|&;<>]/.test(varMatch[1])) {
		return "Command blocked by safe_bash: variable expansion with shell metacharacters is not allowed";
	}

	return null;
}

/**
 * Validate a bash command before execution
 * Throws if dangerous
 */
export function validateCommand(command: string, options: SafeBashOptions = {}): void {
	const danger = isDangerous(command, options);
	if (danger) {
		throw new Error(danger);
	}
}

/**
 * Create a safe bash tool wrapper
 * Returns an object with validation function and patterns for integration
 */
export function createSafeBash(options: SafeBashOptions = {}) {
	return {
		/**
		 * Validate a command. Throws if dangerous.
		 */
		validate(command: string): void {
			validateCommand(command, options);
		},

		/**
		 * Check if a command is dangerous without throwing
		 */
		check(command: string): string | null {
			return isDangerous(command, options);
		},

		/**
		 * Get all active patterns (for debugging/config display)
		 */
		getPatterns(): { dangerous: RegExp[]; additional: RegExp[]; allow: RegExp[] } {
			return {
				dangerous: [...DANGEROUS_PATTERNS],
				additional: options.additionalPatterns || [],
				allow: options.allowPatterns || [],
			};
		},

		/**
		 * Check if safe mode is enabled
		 */
		isEnabled(): boolean {
			return options.enabled !== false;
		},
	};
}

/**
 * Common safe commands that are often blocked but might be needed
 * These can be used in allowPatterns for specific use cases
 */
export const COMMON_SAFE_PATTERNS = {
	// Safe rm with specific paths
	safeRm: /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?((?![\/~])\/)?(tmp|cache|node_modules|dist|build)\//,
	// Safe git operations
	safeGit: /\bgit\s+(clone|pull|push|commit|add|status|diff|log|branch|checkout|merge|rebase)/,
	// Safe npm/yarn/pnpm
	safePackage: /\b(npm|yarn|pnpm|bun)\s+(install|run|test|build|start|dev)/,
	// Safe file read
	safeRead: /\b(cat|head|tail|less|more|grep|find|ls)\s/,
};

/**
 * Preset configurations for different trust levels
 */
export const SAFE_BASH_PRESETS = {
	/** Maximum security - block everything suspicious */
	strict: {
		enabled: true,
		additionalPatterns: [],
		allowPatterns: [],
	},
	/** Moderate - allow common dev operations */
	development: {
		enabled: true,
		additionalPatterns: [],
		allowPatterns: [COMMON_SAFE_PATTERNS.safePackage],
	},
	/** Minimal - only block catastrophic commands */
	permissive: {
		enabled: true,
		additionalPatterns: [],
		allowPatterns: [
			COMMON_SAFE_PATTERNS.safeRm,
			COMMON_SAFE_PATTERNS.safeGit,
			COMMON_SAFE_PATTERNS.safePackage,
			COMMON_SAFE_PATTERNS.safeRead,
		],
	},
	/** No safety checks */
	disabled: {
		enabled: false,
		additionalPatterns: [],
		allowPatterns: [],
	},
};