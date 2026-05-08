import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compressProse, compressToolDescription } from "../../src/runtime/prose-compressor.ts";

describe("prose-compressor", () => {
	describe("compressProse", () => {
		it("removes filler words", () => {
			const result = compressProse("This is just basically a really simple test.");
			assert.ok(!result.compressed.includes("just"));
			assert.ok(!result.compressed.includes("basically"));
			assert.ok(!result.compressed.includes("really"));
			assert.ok(result.compressed.includes("simple test"));
		});

		it("removes articles before lowercase words", () => {
			const result = compressProse("Read the file and update a record.");
			assert.ok(!result.compressed.includes("the file"));
			assert.ok(!result.compressed.includes("a record"));
		});

		it("preserves articles before capitalized words", () => {
			const result = compressProse("Use the React library.");
			assert.ok(result.compressed.includes("React"));
		});

		it("removes pleasantries", () => {
			const result = compressProse("Sure, certainly, of course you can do that.");
			assert.ok(!result.compressed.includes("Sure"));
			assert.ok(!result.compressed.includes("certainly"));
			assert.ok(!result.compressed.includes("of course"));
		});

		it("removes hedging phrases", () => {
			const result = compressProse("Perhaps maybe we could potentially fix this.");
			assert.ok(!result.compressed.includes("Perhaps"));
			assert.ok(!result.compressed.includes("maybe"));
			assert.ok(!result.compressed.includes("potentially"));
		});

		it("removes leading I'll/I will phrases", () => {
			const result = compressProse("I'll help you fix the bug. I will update the file.");
			assert.ok(!result.compressed.startsWith("I'll"));
			assert.ok(result.compressed.includes("fix"));
		});

		it("preserves fenced code blocks byte-for-byte", () => {
			const code = "```typescript\nconst x: number = 42;\n```";
			const text = `Here is the code. ${code} That is the solution.`;
			const result = compressProse(text);
			assert.ok(result.compressed.includes(code));
		});

		it("preserves inline code byte-for-byte", () => {
			const result = compressProse("Use the `useState` hook in the component.");
			assert.ok(result.compressed.includes("`useState`"));
		});

		it("preserves URLs byte-for-byte", () => {
			const url = "https://example.com/api/v2/users";
			const result = compressProse(`Check out the documentation at ${url} for more info.`);
			assert.ok(result.compressed.includes(url));
		});

		it("preserves version numbers", () => {
			const result = compressProse("Requires Node.js 20.10.0 or later version.");
			assert.ok(result.compressed.includes("20.10.0"));
		});

		it("preserves CONSTANT_CASE identifiers", () => {
			const result = compressProse("Set the MAX_CONNECTIONS variable to 100.");
			assert.ok(result.compressed.includes("MAX_CONNECTIONS"));
		});

		it("preserves dotted method calls", () => {
			const result = compressProse("Call fs.readFileSync() to read the file.");
			assert.ok(result.compressed.includes("fs.readFileSync()"));
		});

		it("handles empty input", () => {
			const result = compressProse("");
			assert.equal(result.compressed, "");
			assert.equal(result.savingsPercent, 0);
		});

		it("handles whitespace-only input", () => {
			const result = compressProse("   \n\n  ");
			assert.equal(result.compressed, "");
		});

		it("reports savings percentage", () => {
			const result = compressProse("This is just a really very simple test of the compression module.");
			assert.ok(result.savingsPercent > 0);
			assert.ok(result.compressedLength < result.originalLength);
		});

		it("collapses multiple whitespace", () => {
			const result = compressProse("fix    the    bug");
			assert.ok(!result.compressed.includes("   "));
		});

		it("fixes punctuation spacing", () => {
			const result = compressProse("fix the bug , update the file .");
			assert.ok(!result.compressed.includes(" ,"));
			assert.ok(!result.compressed.includes(" ."));
		});
	});

	describe("compressToolDescription", () => {
		it("returns just the compressed string", () => {
			const result = compressToolDescription("This tool allows you to search for files in the filesystem directory.");
			assert.equal(typeof result, "string");
			assert.ok(result.length > 0);
			assert.ok(result.length < 80);
		});

		it("preserves code in tool descriptions", () => {
			const result = compressToolDescription("Use the `read_file` tool to read a file from the filesystem.");
			assert.ok(result.includes("`read_file`"));
		});
	});
});
