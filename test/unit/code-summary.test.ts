import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	detectLanguage,
	summarizeCode,
	type SummaryResult,
} from "../../src/runtime/code-summary.ts";

// ── detectLanguage ─────────────────────────────────────────────────────

describe("detectLanguage", () => {
	it("detects .ts", () => assert.equal(detectLanguage("foo.ts"), "typescript"));
	it("detects .tsx", () => assert.equal(detectLanguage("foo.tsx"), "typescript"));
	it("detects .js", () => assert.equal(detectLanguage("foo.js"), "javascript"));
	it("detects .jsx", () => assert.equal(detectLanguage("foo.jsx"), "javascript"));
	it("detects .mjs", () => assert.equal(detectLanguage("foo.mjs"), "javascript"));
	it("detects .py", () => assert.equal(detectLanguage("foo.py"), "python"));
	it("detects .rs", () => assert.equal(detectLanguage("foo.rs"), "rust"));
	it("returns null for .go", () => assert.equal(detectLanguage("foo.go"), null));
	it("returns null for .md", () => assert.equal(detectLanguage("foo.md"), null));
	it("returns null for no extension", () => assert.equal(detectLanguage("Makefile"), null));
});

// ── helpers ────────────────────────────────────────────────────────────

function hasElided(result: SummaryResult): boolean {
	return result.segments.some((s) => s.kind === "elided");
}

// ── TypeScript function elision ────────────────────────────────────────

describe("TypeScript function elision", () => {
	it("elides a long function body", () => {
		const code = [
			"function add(a: number, b: number) {",
			"  const sum = a + b;",
			"  console.log(sum);",
			"  console.log(sum);",
			"  console.log(sum);",
			"  return sum;",
			"}",
		].join("\n");
		const result = summarizeCode(code, "typescript");
		assert.equal(result.language, "typescript");
		assert.equal(result.totalLines, 7);
		assert.ok(result.elided, "should be elided");
		assert.ok(result.rendered.includes("lines elided"), result.rendered);
	});

	it("keeps a short function intact", () => {
		const code = [
			"function add(a: number, b: number) {",
			"  return a + b;",
			"}",
		].join("\n");
		const result = summarizeCode(code, "typescript", { minBodyLines: 4 });
		assert.ok(!result.elided, "short function should not be elided");
		assert.equal(result.rendered, code);
	});
});

// ── Class body elision ────────────────────────────────────────────────

describe("Class body elision", () => {
	it("elides class body with many methods", () => {
		const code = [
			"class Foo {",
			"  a() { return 1; }",
			"  b() { return 2; }",
			"  c() { return 3; }",
			"  d() { return 4; }",
			"  e() { return 5; }",
			"}",
		].join("\n");
		const result = summarizeCode(code, "typescript");
		assert.ok(result.elided, "class body should be elided");
	});
});

// ── Block comment elision ─────────────────────────────────────────────

describe("Block comment elision", () => {
	it("elides long block comments", () => {
		const comment = [
			"/*",
			" * line 1",
			" * line 2",
			" * line 3",
			" * line 4",
			" * line 5",
			" * line 6",
			" * line 7",
			" */",
		].join("\n");
		const result = summarizeCode(comment, "typescript");
		assert.ok(result.elided, "block comment should be elided");
		assert.ok(result.rendered.includes("lines elided"));
	});

	it("keeps short block comments", () => {
		const comment = ["/*", " * short", " */"].join("\n");
		const result = summarizeCode(comment, "typescript");
		assert.ok(!result.elided, "short comment should not be elided");
	});
});

// ── Short code / empty ────────────────────────────────────────────────

describe("Edge cases", () => {
	it("returns empty for empty code", () => {
		const result = summarizeCode("", "typescript");
		assert.equal(result.totalLines, 0);
		assert.equal(result.rendered, "");
		assert.ok(!result.elided);
	});

	it("returns full code for whitespace-only input", () => {
		const result = summarizeCode("   \n  \n", "typescript");
		assert.ok(!result.elided);
	});
});

// ── Unknown language ──────────────────────────────────────────────────

describe("Unknown language", () => {
	it("returns full code when language is null", () => {
		const code = "fn main() { println!(\"hello\"); }";
		const result = summarizeCode(code, null);
		assert.equal(result.language, null);
		assert.ok(!result.elided);
		assert.equal(result.rendered, code);
	});

	it("returns full code for unsupported language", () => {
		const code = "package main\nfunc main() {}";
		const result = summarizeCode(code, "go");
		assert.ok(!result.elided);
		assert.equal(result.rendered, code);
	});
});

// ── Python function elision ───────────────────────────────────────────

describe("Python function elision", () => {
	it("elides a long Python function body", () => {
		const code = [
			"def process(data):",
			"    x = 1",
			"    y = 2",
			"    z = 3",
			"    w = 4",
			"    return x + y + z + w",
		].join("\n");
		const result = summarizeCode(code, "python");
		assert.equal(result.language, "python");
		assert.ok(result.elided, "python function should be elided");
		assert.ok(result.rendered.includes("def process(data):"), result.rendered);
		assert.ok(result.rendered.includes("lines elided"), result.rendered);
	});

	it("keeps a short Python function intact", () => {
		const code = ["def add(a, b):", "    return a + b"].join("\n");
		const result = summarizeCode(code, "python", { minBodyLines: 4 });
		assert.ok(!result.elided);
	});
});

// ── Rust fn elision ───────────────────────────────────────────────────

describe("Rust fn elision", () => {
	it("elides a long Rust function body", () => {
		const code = [
			"fn main() {",
			"    let a = 1;",
			"    let b = 2;",
			"    let c = 3;",
			"    let d = 4;",
			"    println!(\"{}\", a + b + c + d);",
			"}",
		].join("\n");
		const result = summarizeCode(code, "rust");
		assert.equal(result.language, "rust");
		assert.ok(result.elided, "rust fn body should be elided");
		assert.ok(result.rendered.includes("fn main() {"), result.rendered);
		assert.ok(result.rendered.includes("}"), result.rendered);
	});
});
