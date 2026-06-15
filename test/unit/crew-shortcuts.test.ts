import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	registerCrewShortcuts,
	CREW_SHORTCUT_KEYS,
} from "../../src/extension/crew-shortcuts.ts";

describe("registerCrewShortcuts", () => {
	it("registers every crew shortcut on a Pi-like object", () => {
		const registered: Array<{ key: unknown; description?: string }> = [];
		const fakePi = {
			registerShortcut: (key: unknown, options: { description?: string }) => {
				registered.push({ key, description: options.description });
			},
		};
		registerCrewShortcuts(fakePi);
		assert.equal(registered.length, CREW_SHORTCUT_KEYS.length);
		// alt+s must be present (settings overlay)
		assert.ok(registered.some((r) => r.key === "alt+s"), "alt+s shortcut should be registered");
		for (const r of registered) {
			assert.ok(typeof r.description === "string" && r.description.length > 0, "each shortcut needs a description");
		}
	});

	it("is a no-op when registerShortcut is unavailable (older Pi)", () => {
		// Should not throw even with an empty object.
		assert.doesNotThrow(() => registerCrewShortcuts({}));
		assert.doesNotThrow(() => registerCrewShortcuts({ registerShortcut: undefined }));
	});

	it("uses keys that do not collide with Pi's built-in keymap", () => {
		// Pi's built-in alt+letter bindings are only: alt+v, alt+enter,
		// alt+down/up/left/right. Any other alt+<letter> is free.
		const piBuiltinAlt = new Set(["alt+v", "alt+enter", "alt+down", "alt+up", "alt+left", "alt+right"]);
		for (const key of CREW_SHORTCUT_KEYS) {
			assert.ok(!piBuiltinAlt.has(key), `crew shortcut ${key} must not collide with a Pi built-in`);
		}
	});

	it("the alt+s handler is an async-friendly function", () => {
		const captured: Array<{ key: unknown; handler: unknown }> = [];
		const fakePi = {
			registerShortcut: (key: unknown, options: { handler: unknown }) => {
				captured.push({ key, handler: options.handler });
			},
		};
		registerCrewShortcuts(fakePi);
		const settingsEntry = captured.find((c) => c.key === "alt+s");
		assert.ok(settingsEntry, "alt+s entry should exist");
		assert.equal(typeof settingsEntry?.handler, "function");
	});
});
