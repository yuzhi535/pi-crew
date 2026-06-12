/**
 * Centralized type guard library for pi-crew.
 *
 * Inspired by @ayulab/runtime-core — all unknown-to-narrowed checks
 * go through these helpers instead of inline typeof/instanceof.
 */

// ── Primitive guards ──────────────────────────────────────────────────

/** Narrow `unknown` to `Record<string, unknown>`. */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Narrow `unknown` to `string`. */
export function isString(value: unknown): value is string {
	return typeof value === "string";
}

/** Narrow `unknown` to a non-empty string. */
export function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

/** Narrow `unknown` to `number` (excludes NaN). */
export function isNumber(value: unknown): value is number {
	return typeof value === "number" && !Number.isNaN(value);
}

/** Narrow `unknown` to `boolean`. */
export function isBoolean(value: unknown): value is boolean {
	return typeof value === "boolean";
}

/** Narrow `unknown` to `readonly string[]`. */
export function isStringArray(value: unknown): value is readonly string[] {
	return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/**
 * Higher-order guard: build a guard that checks every element of an array.
 *
 * @example
 * const isNumberArray = isArrayOf(isNumber);
 */
export function isArrayOf<T>(
	guard: (item: unknown) => item is T,
): (value: unknown) => value is readonly T[] {
	return (value: unknown): value is readonly T[] =>
		Array.isArray(value) && value.every(guard);
}

// ── Record field extractors ───────────────────────────────────────────

/** Extract a string field from a record, returning `undefined` if absent. */
export function getStringField(value: unknown, key: string): string | undefined {
	if (!isRecord(value)) return undefined;
	const field = value[key];
	return typeof field === "string" ? field : undefined;
}

/** Extract a number field from a record, returning `undefined` if absent. */
export function getNumberField(value: unknown, key: string): number | undefined {
	if (!isRecord(value)) return undefined;
	const field = value[key];
	return typeof field === "number" && !Number.isNaN(field) ? field : undefined;
}

/** Extract a boolean field from a record, returning `undefined` if absent. */
export function getBooleanField(value: unknown, key: string): boolean | undefined {
	if (!isRecord(value)) return undefined;
	const field = value[key];
	return typeof field === "boolean" ? field : undefined;
}

/** Extract a nested record field from a record, returning `undefined` if absent. */
export function getRecordField(value: unknown, key: string): Record<string, unknown> | undefined {
	if (!isRecord(value)) return undefined;
	const field = value[key];
	return isRecord(field) ? field : undefined;
}

/** Extract an array field from a record, returning `undefined` if absent. */
export function getArrayField(value: unknown, key: string): unknown[] | undefined {
	if (!isRecord(value)) return undefined;
	const field = value[key];
	return Array.isArray(field) ? field : undefined;
}

// ── Error helpers ─────────────────────────────────────────────────────

/**
 * Extract a human-readable message from an unknown error value.
 *
 * Prefer this over manual `instanceof Error` checks to keep error
 * handling uniform across the codebase.
 */
export function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

// ── Utility types ─────────────────────────────────────────────────────

/** A non-empty readonly array type. */
export type NonEmptyReadonlyArray<T> = readonly [T, ...T[]];

/** Narrow a readonly array to a non-empty readonly array. */
export function hasItems<T>(items: readonly T[]): items is NonEmptyReadonlyArray<T> {
	return items.length > 0;
}
