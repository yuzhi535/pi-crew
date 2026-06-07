import { isSecretKey } from "./redaction.ts";

export interface SanitizeEnvOptions {
	/** Allow-list of env var names to preserve. Supports trailing glob, e.g. `"PI_*"`. */
	allowList?: string[];
}

/**
 * Strip env vars whose keys look like secrets before passing to child processes.
 *
 * Default mode (no allowList): deny-list using isSecretKey.
 * When allowList is provided, only keys matching the allow-list are preserved.
 */
export function sanitizeEnvSecrets(env: NodeJS.ProcessEnv, options?: SanitizeEnvOptions): Record<string, string> {
	const filtered: Record<string, string> = {};
	if (options?.allowList && options.allowList.length > 0) {
		const matchers = options.allowList.map((p) => {
			if (p.endsWith("*")) {
				// Glob pattern: matches any key that starts with the prefix and has
				// additional characters (i.e., prefix itself is not a full match).
				// For example, "PI_CREW_*" matches "PI_CREW_DEPTH" but not "PI_CREW_".
				const prefix = p.slice(0, -1);
				return (k: string) => k.startsWith(prefix) && k.length > prefix.length;
			}
			// Exact match is case-sensitive; Unix env vars are uppercase by convention.
			return (k: string) => k === p;
		});
		for (const [key, value] of Object.entries(env)) {
			if (value !== undefined && matchers.some((fn) => fn(key))) filtered[key] = value;
		}
		return filtered;
	}
	for (const [key, value] of Object.entries(env)) {
		if (value !== undefined && !isSecretKey(key)) filtered[key] = value;
	}
	return filtered;
}