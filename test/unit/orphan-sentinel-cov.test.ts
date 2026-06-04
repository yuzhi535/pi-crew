import { describe, it } from "node:test";
import assert from "node:assert/strict";

// orphan-sentinel is a deprecated no-op module. We import it to confirm
// it loads without error and verify the placeholder nature.
describe("orphan-sentinel", () => {
	it("module imports without error", async () => {
		// The module has no exports but should still import cleanly
		const mod = await import("../../src/runtime/orphan-sentinel.ts");
		assert.ok(mod, "module loaded");
	});

	it("module exports empty object (no functions)", async () => {
		const mod = await import("../../src/runtime/orphan-sentinel.ts");
		const exportedKeys = Object.keys(mod);
		assert.deepStrictEqual(exportedKeys, []);
	});

	it("does not throw when imported multiple times", async () => {
		await import("../../src/runtime/orphan-sentinel.ts");
		await import("../../src/runtime/orphan-sentinel.ts");
		assert.ok(true, "multiple imports succeed");
	});
});
