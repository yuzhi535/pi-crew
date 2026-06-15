/**
 * test-env-helpers.ts — Robust env-var save/restore for tests (Round 19 fix).
 *
 * Round 19 test-health audit found a copy-paste env-restore bug in
 * task-runner-heartbeat.test.ts and mock-child-run.test.ts:
 *   - restored the WRONG variable (PI_CREW_ALLOW_MOCK instead of PI_TEAMS_MOCK_CHILD_PI)
 *   - set env to the STRING "undefined" when the previous value was undefined
 *     (should DELETE the key instead)
 *   - never restored PI_CREW_ALLOW_MOCK at all → leaked into sibling tests
 *
 * This helper does save/restore correctly: undefined → delete key; defined →
 * restore exact value.
 */

export interface EnvSnapshot {
	[key: string]: string | undefined;
}

/**
 * Capture the current values of the given env vars. Missing keys are stored
 * as `undefined` so restore() will delete them.
 */
export function snapshotEnv(keys: string[]): EnvSnapshot {
	const snap: EnvSnapshot = {};
	for (const k of keys) snap[k] = process.env[k];
	return snap;
}

/**
 * Restore env vars to a prior snapshot. `undefined` values DELETE the key
 * (not set to the string "undefined").
 */
export function restoreEnv(snap: EnvSnapshot): void {
	for (const [k, v] of Object.entries(snap)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
}

/**
 * Convenience: run a callback with a set of env overrides, then restore the
 * prior values in a finally. Returns the callback's result.
 *
 * @example
 *   await withEnv({ PI_CREW_ALLOW_MOCK: "1", PI_TEAMS_MOCK_CHILD_PI: "json-success" }, async () => {
 *     // ... test body ...
 *   });
 */
export async function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
	const snap = snapshotEnv(Object.keys(overrides));
	for (const [k, v] of Object.entries(overrides)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
	try {
		return await fn();
	} finally {
		restoreEnv(snap);
	}
}
