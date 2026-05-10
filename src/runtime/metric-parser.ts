/**
 * Metric names that are denied to prevent prototype pollution.
 */
export const DENIED_METRIC_NAMES: ReadonlySet<string> = new Set([
	"__proto__",
	"constructor",
	"prototype",
]);

const METRIC_LINE_RE = /^CREW_METRIC\s+(\w+)=(\S+)$/;

/**
 * Parse CREW_METRIC lines from worker stdout.
 *
 * Lines must match the pattern: `CREW_METRIC name=value`
 * - `name` must be a word character sequence (alphanumeric + underscore)
 * - `value` must parse as a valid finite number
 * - Denied names (__proto__, constructor, prototype) are silently skipped
 *
 * @param output - Raw worker stdout text
 * @returns Map of metric name → numeric value
 */
export function parseMetricLines(output: string): Record<string, number> {
	const metrics: Record<string, number> = {};

	for (const line of output.split("\n")) {
		const match = METRIC_LINE_RE.exec(line);
		if (!match) continue;

		const [, name, rawValue] = match;
		if (DENIED_METRIC_NAMES.has(name)) continue;

		const value = Number(rawValue);
		if (!Number.isFinite(value)) continue;

		metrics[name] = value;
	}

	return metrics;
}
