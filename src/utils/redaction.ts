/**
 * ReDoS-resistant pattern matching for secret detection.
 * Uses linear-time scan instead of complex regex to prevent catastrophic backtracking.
 */

// Pattern for PEM private keys (possessive quantifier prevents backtracking)
export const PEM_PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+PRIVATE KEY-----/g;

// Linear-time secret key detection
export function isSecretKey(keyName: string): boolean {
	// Fast path: common secret key names
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
	
	// Replace Bearer tokens
	result = redactBearerTokens(result);
	
	// Replace inline secrets: key=value or key:value patterns
	result = redactInlineSecrets(result);
	
	return result;
}

// Linear-time inline secret redaction: token=xxx, api_key=xxx, etc.
function redactInlineSecrets(value: string): string {
	const result: string[] = [];
	let i = 0;
	
	while (i < value.length) {
		// Look for pattern: word_chars + = or : + non-whitespace_value
		// Check for secret key followed by = or :
		let j = i;
		let keyLen = 0;
		
		// Collect key characters (alphanumeric, underscore, hyphen)
		while (j < value.length && /[a-zA-Z0-9_-]/.test(value[j])) {
			j++;
			keyLen++;
		}
		
		if (keyLen > 0 && j < value.length && (value[j] === '=' || value[j] === ':')) {
			const key = value.substring(i, i + keyLen);
			
			// Check if this is a secret key
			if (isSecretKey(key)) {
				// Find the value (everything after = or : until space, comma, or end)
				const sep = value[j];
				let k = j + 1;
				let valLen = 0;
				while (k < value.length && valLen < 500 && value[k] !== ' ' && value[k] !== ',' && value[k] !== ';' && value[k] !== '"' && value[k] !== '"' && value[k] !== '\r' && value[k] !== '\n') {
					k++;
					valLen++;
				}
				
				// Only redact if there's actual content
				if (valLen > 0) {
					result.push(key);
					result.push(sep);
					result.push("***");
					i = k;
					continue;
				}
			}
		}
		
		result.push(value[i]);
		i++;
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