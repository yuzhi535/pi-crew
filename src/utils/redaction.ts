/**
 * ReDoS-resistant pattern matching for secret detection.
 * Uses linear-time scan instead of complex regex to prevent catastrophic backtracking.
 */

// Pattern for PEM private keys (possessive quantifier prevents backtracking)
export const PEM_PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+PRIVATE KEY-----/g;

// --- P1f (RFC §P1f / §6 STRIDE) — additional anchored, ReDoS-SAFE secret patterns. ---
// All patterns below are LINEAR-TIME: each uses a single bounded quantifier on a
// character class (fixed {N} or a plain +) with NO nested quantifiers and NO
// overlapping alternation. Boundaries are zero-width lookarounds on simple char
// classes, which are also linear. Do NOT introduce (a+)+-style nesting here.
//
// RESIDUAL (documented, Med-High per RFC §6): regex redaction is BEST-EFFORT
// against an *adversarial* worker that can encode/split/transform secrets
// (base64, line splits, novel formats, non-pattern env vars). This catches the
// common/accidental leak; it is NOT a boundary against a determined exfiltrator.
// Full mitigation ladder: (1) redaction here + at artifact-write; (2) Phase 1.5
// sanitized-env verification; (3) sandbox (deferred).

// JWT — three base64url segments separated by dots, distinctive "eyJ" headers.
// Linear: single + on [A-Za-z0-9_-] per segment, no nesting.
export const JWT_PATTERN = /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

// GitHub PAT (classic + fine-grained prefixes) — fixed 36-char base62 tail.
// Linear: fixed {36} count on a char class (constant time per match position).
export const GITHUB_PAT_PATTERN = /(?<![A-Za-z0-9_])gh[pousr]_[A-Za-z0-9]{36}(?![A-Za-z0-9])/g;

// AWS access key id — fixed 16-char uppercase-alphanumeric tail.
// Linear: fixed {16} count on a char class.
export const AWS_ACCESS_KEY_PATTERN = /(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}(?![0-9A-Z])/g;

// Optional extras (RFC OQ13) — same ReDoS-safe shape (fixed counts / single +).
export const SLACK_TOKEN_PATTERN = /(?<![A-Za-z0-9_-])xox[baprs]-[A-Za-z0-9-]{10,}/g;
export const GOOGLE_API_KEY_PATTERN = /(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/g;
export const STRIPE_KEY_PATTERN = /(?<![A-Za-z0-9_])sk_live_[0-9a-zA-Z]{24}(?![0-9a-zA-Z])/g;

// Linear-time secret key detection
// IMPORTANT: This function must maintain linear-time guarantees.
// The fast-path regex uses simple string alternatives with anchors only (no quantifiers),
// and the linear scan iterates through characters once. If either path is replaced with
// a more complex regex, catastrophic backtracking (ReDoS) could result.
// Any modifications must preserve O(n) complexity where n = keyName.length.
export function isSecretKey(keyName: string): boolean {
	// Fast path: common secret key names (safe anchored regex, no backtracking)
	const lower = keyName.toLowerCase();
	if (/^(token|apikey|api_key|password|secret|credential|authorization|privatekey|private_key)$/.test(lower)) {
		return true;
	}
	// Linear scan for prefix characters followed by keywords
	const prefixes = "_.-";
	const keywords = ["token", "api", "key", "password", "passwd", "secret", "credential", "authorization", "private"];

	for (let i = 0; i < keyName.length; i++) {
		if (prefixes.includes(keyName[i])) {
			const remaining = keyName.substring(i + 1).toLowerCase();
			for (const kw of keywords) {
				if (remaining.startsWith(kw)) {
					const afterKw = remaining.substring(kw.length);
					if (afterKw === "" || prefixes.includes(afterKw[0]) || /[a-zA-Z0-9]/.test(afterKw[0])) {
						return true;
					}
				}
			}
		}
	}
	// FIX (P1f, surfaced by notification-sink test): also match camelCase
	// boundaries (e.g. `apiToken`, `clientSecret`, `authKey`) — the separator
	// scan above requires `_-.` between prefix and keyword and MISSES the very
	// common camelCase pattern. Scan: a keyword matches if it appears with a
	// word boundary (start of string, end of string, camelCase lowercase->upper
	// transition, or one of `_-.` separators). Linear: one forward pass.
	for (const kw of keywords) {
		let from = 0;
		while (true) {
			const idx = lower.indexOf(kw, from);
			if (idx === -1) break;
			const before = idx === 0 ? "" : lower.charAt(idx - 1);
			const afterIdx = idx + kw.length;
			const afterCh = afterIdx >= lower.length ? "" : lower.charAt(afterIdx);
			const atStart = idx === 0;
			const atEnd = afterIdx === lower.length;
			const camelBoundary = /[A-Z]/.test(keyName.charAt(afterIdx)); // lowercase->uppercase in original
			const sepBoundary = prefixes.includes(before) || prefixes.includes(afterCh);
			if (atStart || atEnd || camelBoundary || sepBoundary) {
				// Require non-empty chars before/after to avoid matching `api` inside `capitalize`
				const hasBefore = idx > 0;
				const hasAfter = afterIdx < lower.length;
				if (hasBefore || hasAfter) return true;
			}
			from = idx + 1;
		}
	}
	return false;
}

// Linear-time Authorization header redaction
export function redactAuthHeader(line: string): string {
	const lower = line.toLowerCase();
	const authIdx = lower.indexOf("authorization:");
	if (authIdx === -1) return line;
	
	// Verify word boundary - must be at start of line or preceded by whitespace/comma/brace
	if (authIdx > 0) {
		const before = line[authIdx - 1];
		if (before !== ' ' && before !== ',' && before !== '{' && before !== '[' && before !== '"' && before !== '\r' && before !== '\n') {
			return line; // Not a word boundary
		}
	}
	
	// Check if this is followed by Bearer token (don't redact Bearer tokens separately)
	// Look for "Bearer" after "authorization:"
	const afterAuth = lower.substring(authIdx + 14).trimStart();
	if (!afterAuth.startsWith('bearer ')) {
		// No Bearer token, this is a regular Authorization header - redact it
		let end = authIdx + 14;
		while (end < line.length && line[end] !== "\r" && line[end] !== "\n") {
			end++;
		}
		return line.substring(0, end) + " ***" + (end < line.length ? line.substring(end) : "");
	}
	
	// It's a Bearer token format - don't redact here, let redactBearerTokens handle it
	return line;
}

// Linear-time Bearer token redaction
export function redactBearerTokens(line: string): string {
	const upper = line.toUpperCase();
	const result: string[] = [];
	let i = 0;
	
	while (i < line.length) {
		if (upper.startsWith("BEARER ", i)) {
			// Check word boundary: preceded by start, space, comma, brace, or newline
			if (i > 0) {
				const before = line[i - 1];
				if (before !== ' ' && before !== ',' && before !== '{' && before !== '[' && before !== '"' && before !== '\r' && before !== '\n') {
					result.push(line[i]);
					i++;
					continue;
				}
			}
			
			// Found "Bearer " - now find the token
			const bearerPrefix = line.substring(i, i + 7); // "Bearer "
			let j = i + 7;
			let tokenLen = 0;
			while (j < line.length && tokenLen < 200 && /[A-Za-z0-9._~+/-]/.test(line[j])) {
				j++;
				tokenLen++;
			}
			
			if (tokenLen >= 8) {
				// Replace with Bearer + *** (redact the token)
				result.push(bearerPrefix + "***");
				i = j;
				continue;
			}
		}
		result.push(line[i]);
		i++;
	}
	
	return result.join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	if (value instanceof Date || value instanceof RegExp || value instanceof Error || value instanceof Map || value instanceof Set) return false;
	return true;
}

export function redactSecretString(value: string): string {
	let result = value;
	
	// Replace PEM private keys
	result = result.replace(PEM_PRIVATE_KEY_PATTERN, "***");
	
	// Replace Authorization headers (non-Bearer format)
	result = redactAuthHeader(result);
	
	// Replace Bearer tokens (run before structured-token patterns so a
	// "Bearer <jwt>" pair is collapsed first; bare tokens are caught below).
	result = redactBearerTokens(result);
	
	// P1f: structured secret tokens (JWT / GitHub PAT / AWS keys + optional
	// Slack/Google/Stripe). Best-effort vs adversarial workers (see note above).
	result = result
		.replace(JWT_PATTERN, "***")
		.replace(GITHUB_PAT_PATTERN, "***")
		.replace(AWS_ACCESS_KEY_PATTERN, "***")
		.replace(SLACK_TOKEN_PATTERN, "***")
		.replace(GOOGLE_API_KEY_PATTERN, "***")
		.replace(STRIPE_KEY_PATTERN, "***");
	
	// Replace inline secrets: key=value or key:value patterns
	result = redactInlineSecrets(result);
	
	return result;
}

// Linear-time inline secret redaction: token=xxx, api_key=xxx, etc.
// FIX (P1f): previously O(n^2) — after a non-secret alphanumeric run, the loop did
// i++ (advance 1 char) and re-scanned from i+1, so a long run was rescanned O(n)
// times = O(n^2). The P1f ReDoS test (300KB no-dot input) surfaced this pre-existing
// bug. Now advances past the whole run when it isn't a redactable secret -> O(n).
function redactInlineSecrets(value: string): string {
	const result: string[] = [];
	let i = 0;

	while (i < value.length) {
		// Collect a run of key characters (alphanumeric, underscore, hyphen).
		let j = i;
		while (j < value.length && /[a-zA-Z0-9_-]/.test(value[j])) {
			j++;
		}
		const keyLen = j - i;

		let redacted = false;
		if (keyLen > 0 && j < value.length && (value[j] === '=' || value[j] === ':')) {
			const key = value.substring(i, j);

			// Check if this is a secret key
			if (isSecretKey(key)) {
				// Find the value (everything after = or : until space, comma, or end)
				const sep = value[j];
				let k = j + 1;
				let valLen = 0;
				while (k < value.length && valLen < 500 && value[k] !== ' ' && value[k] !== ',' && value[k] !== ';' && value[k] !== '"' && value[k] !== '\r' && value[k] !== '\n') {
					k++;
					valLen++;
				}

				// Only redact if there's actual content
				if (valLen > 0) {
					result.push(key);
					result.push(sep);
					result.push("***");
					i = k;
					redacted = true;
				}
			}
		}

		if (!redacted) {
			if (keyLen > 0) {
				// Not a redactable secret — push the WHOLE run and advance past it (O(n)).
				result.push(value.substring(i, j));
				i = j;
			} else {
				// Single non-key character (space, punctuation, etc.)
				result.push(value[i]);
				i++;
			}
		}
	}

	return result.join("");
}

export function redactSecrets(value: unknown, keyName = ""): unknown {
	if (keyName && isSecretKey(keyName)) return "***";
	if (typeof value === "string") return redactSecretString(value);
	if (Array.isArray(value)) return value.map((item) => redactSecrets(item));
	if (isRecord(value)) {
		const output: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value)) output[key] = redactSecrets(entry, key);
		return output;
	}
	return value;
}

export function redactJsonLine(line: string): string {
	try {
		return JSON.stringify(redactSecrets(JSON.parse(line) as unknown));
	} catch {
		return redactSecretString(line);
	}
}