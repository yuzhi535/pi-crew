import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUILT_AGAINST_PI_VERSION } from "../../src/extension/pi-api.ts";

describe("BUILT_AGAINST_PI_VERSION", () => {
	it("FIX #10: matches the actually-installed @earendil-works/pi-coding-agent version", () => {
		// BUILT_AGAINST_PI_VERSION is a seam constant documenting which Pi version
		// pi-crew was built/tested against. If it drifts from the installed package
		// version, the diagnostic becomes misleading. Read the installed version at
		// test time so this test always catches drift.
		const nodeModulesPkg = JSON.parse(
			readFileSync(
				join(
					import.meta.dirname,
					"..",
					"..",
					"node_modules",
					"@earendil-works",
					"pi-coding-agent",
					"package.json",
				),
				"utf-8",
			),
		) as { version: string };
		const installedVersion = nodeModulesPkg.version;
		assert.equal(
			BUILT_AGAINST_PI_VERSION,
			installedVersion,
			`BUILT_AGAINST_PI_VERSION must match installed @earendil-works/pi-coding-agent version ` +
				`(${installedVersion}); got ${BUILT_AGAINST_PI_VERSION}`,
		);
	});

	it("FIX #10: is a non-empty string", () => {
		assert.ok(typeof BUILT_AGAINST_PI_VERSION === "string");
		assert.ok(BUILT_AGAINST_PI_VERSION.length > 0);
	});
});
