import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { normalizeSeedPaths, overlaySeedPaths } from "../../src/worktree/worktree-manager.ts";

describe("normalizeSeedPaths", () => {
	const repoRoot = "/fake/repo";

	it("rejects path traversal", () => {
		assert.throws(
			() => normalizeSeedPaths(["../../etc/passwd"], repoRoot),
			/must stay inside repoRoot/,
		);
	});

	it("rejects absolute paths", () => {
		assert.throws(
			() => normalizeSeedPaths(["/etc/passwd"], repoRoot),
			/must stay inside repoRoot/,
		);
	});

	it("normalizes separators to forward slashes", () => {
		// On Windows, path.sep is backslash; normalize to forward slash
		const result = normalizeSeedPaths(["foo/bar.txt"], repoRoot);
		assert.equal(result[0], "foo/bar.txt");
	});

	it("deduplicates entries", () => {
		const result = normalizeSeedPaths(["a.txt", "a.txt", "b.txt"], repoRoot);
		assert.deepEqual(result, ["a.txt", "b.txt"]);
	});

	it("skips empty and whitespace-only entries", () => {
		const result = normalizeSeedPaths(["", "  ", "a.txt"], repoRoot);
		assert.deepEqual(result, ["a.txt"]);
	});

	it("returns empty array for empty input", () => {
		assert.deepEqual(normalizeSeedPaths([], repoRoot), []);
	});

	it("returns empty array for non-array input", () => {
		assert.deepEqual(normalizeSeedPaths(null as any, repoRoot), []);
	});
});

describe("overlaySeedPaths", () => {
	let tmpDir: string;
	let repoRoot: string;
	let worktreePath: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "seed-test-"));
		repoRoot = path.join(tmpDir, "repo");
		worktreePath = path.join(tmpDir, "worktree");
		fs.mkdirSync(repoRoot, { recursive: true });
		fs.mkdirSync(worktreePath, { recursive: true });
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { force: true, recursive: true });
	});

	it("copies a file from repoRoot to worktreePath", () => {
		fs.writeFileSync(path.join(repoRoot, "plan.json"), '{"test": true}');
		overlaySeedPaths(repoRoot, worktreePath, ["plan.json"]);
		assert.ok(fs.existsSync(path.join(worktreePath, "plan.json")));
		assert.equal(
			fs.readFileSync(path.join(worktreePath, "plan.json"), "utf8"),
			'{"test": true}',
		);
	});

	it("copies a directory recursively", () => {
		fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
		fs.writeFileSync(path.join(repoRoot, "scripts", "run.sh"), "#!/bin/bash");
		overlaySeedPaths(repoRoot, worktreePath, ["scripts"]);
		assert.ok(fs.existsSync(path.join(worktreePath, "scripts", "run.sh")));
	});

	it("creates parent directories in worktree", () => {
		fs.mkdirSync(path.join(repoRoot, "deep", "nested"), { recursive: true });
		fs.writeFileSync(
			path.join(repoRoot, "deep", "nested", "file.txt"),
			"content",
		);
		overlaySeedPaths(repoRoot, worktreePath, ["deep/nested/file.txt"]);
		assert.ok(
			fs.existsSync(
				path.join(worktreePath, "deep", "nested", "file.txt"),
			),
		);
	});

	it("is no-op with empty seedPaths", () => {
		overlaySeedPaths(repoRoot, worktreePath, []);
		// Should not throw or create anything
		const entries = fs.readdirSync(worktreePath);
		assert.equal(entries.length, 0);
	});

	it("overwrites existing files in worktree", () => {
		fs.writeFileSync(path.join(repoRoot, "config.json"), '{"v": 2}');
		fs.writeFileSync(path.join(worktreePath, "config.json"), '{"v": 1}');
		overlaySeedPaths(repoRoot, worktreePath, ["config.json"]);
		assert.equal(
			fs.readFileSync(path.join(worktreePath, "config.json"), "utf8"),
			'{"v": 2}',
		);
	});
});
