/**
 * Session ID utilities for pi-crew / pi session alignment.
 *
 * pi's session IDs use the format:
 * ^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$
 *
 * This module provides utilities to generate valid pi session IDs
 * that align with pi-crew run IDs for easy cross-referencing.
 */

/**
 * Validate session ID format per pi's requirements.
 * Format: ^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$
 */
export function assertValidSessionId(id: string): void {
	if (!id || !/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(id)) {
		throw new Error(
			`Invalid session id: must be non-empty, alphanumeric with '-', '_', '.' and start/end with alphanumeric`,
		);
	}
}

/**
 * Convert a pi-crew run ID to a valid pi session ID.
 *
 * - Strips non-alphanumeric characters
 * - Lowercases
 * - Prefixes with "crew-"
 * - Truncates to 16 chars for safety
 *
 * @param runId - The pi-crew run ID (e.g., "team_20260528133725_02e05cc5480d0175")
 * @returns Valid pi session ID (e.g., "crew-team20260528133")
 */
export function toPiSessionId(runId: string): string {
	// Strip non-alphanumeric, lowercase, prefix with "crew-"
	const sanitized = runId.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
	return `crew-${sanitized.slice(0, 16)}`;
}

/**
 * Validate and convert a run ID to a pi session ID.
 * Returns the session ID if valid, or undefined if conversion would produce invalid ID.
 */
export function safeToPiSessionId(runId: string): string | undefined {
	try {
		const sessionId = toPiSessionId(runId);
		assertValidSessionId(sessionId);
		return sessionId;
	} catch {
		return undefined;
	}
}