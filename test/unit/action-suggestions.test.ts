import test from "node:test";
import assert from "node:assert/strict";
import {
	KNOWN_TEAM_ACTIONS,
	suggestAction,
	formatActionSuggestion,
} from "../../src/extension/action-suggestions.ts";

test("KNOWN_TEAM_ACTIONS includes the core lifecycle actions", () => {
	for (const a of ["run", "status", "wait", "list", "get", "cancel", "summary", "help"]) {
		assert.ok((KNOWN_TEAM_ACTIONS as readonly string[]).includes(a), `${a} should be a known action`);
	}
});

test("suggestAction returns null for an unrelated string", () => {
	assert.equal(suggestAction("zzzzqqqx"), null);
});

test("suggestAction fixes common typos", () => {
	assert.equal(suggestAction("stat"), "status");
	assert.equal(suggestAction("summery"), "summary");
	assert.equal(suggestAction("summry"), "summary");
	assert.equal(suggestAction("cancle"), "cancel");
	assert.equal(suggestAction("reume"), "resume");
	assert.equal(suggestAction("hlep"), "help");
});

test("suggestAction returns the action verbatim when it is already valid", () => {
	assert.equal(suggestAction("status"), "status");
});

test("formatActionSuggestion returns empty string for no good match", () => {
	assert.equal(formatActionSuggestion("zzzzqqqx"), "");
	assert.equal(formatActionSuggestion(""), "");
});

test("formatActionSuggestion returns '' for an already-valid action (no noise)", () => {
	assert.equal(formatActionSuggestion("status"), "");
});

test("formatActionSuggestion formats a Did-you-mean hint with the action name + help nudge", () => {
	const out = formatActionSuggestion("stat");
	assert.match(out, /Did you mean 'status'\?/);
	assert.match(out, /action='status'/);
	assert.match(out, /action='help'/);
});

test("formatActionSuggestion for a near-miss of 'summary'", () => {
	const out = formatActionSuggestion("summry");
	assert.match(out, /Did you mean 'summary'\?/);
});

test("formatActionSuggestion output is directly appendable to an error message", () => {
	// The dispatch builds `Unknown action: ${action}${formatActionSuggestion(...)}`.
	// Verify the composite reads naturally.
	const msg = `Unknown action: stat${formatActionSuggestion("stat")}`;
	assert.match(msg, /^Unknown action: stat\n\nDid you mean 'status'\?/);
});
