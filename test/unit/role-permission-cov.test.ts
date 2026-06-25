import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	permissionForRole,
	isReadOnlyCommand,
	checkRolePermission,
	currentCrewRole,
	checkSubagentSpawnPermission,
} from "../../src/runtime/role-permission.ts";

// ── permissionForRole ───────────────────────────────────────────────────

describe("permissionForRole", () => {
	it("returns 'read_only' for explorer", () => {
		assert.strictEqual(permissionForRole("explorer"), "read_only");
	});

	it("returns 'read_only' for reviewer", () => {
		assert.strictEqual(permissionForRole("reviewer"), "read_only");
	});

	it("returns 'read_only' for security-reviewer", () => {
		assert.strictEqual(permissionForRole("security-reviewer"), "read_only");
	});

	it("returns 'read_only' for verifier", () => {
		assert.strictEqual(permissionForRole("verifier"), "read_only");
	});

	it("returns 'read_only' for analyst", () => {
		assert.strictEqual(permissionForRole("analyst"), "read_only");
	});

	it("returns 'read_only' for critic", () => {
		assert.strictEqual(permissionForRole("critic"), "read_only");
	});

	it("returns 'read_only' for planner", () => {
		assert.strictEqual(permissionForRole("planner"), "read_only");
	});

	it("returns 'workspace_write' for writer (P0 fix 2026-06-25 — parallel-research incident)", () => {
		// Round 20: writer was misclassified as read-only, blocking built-in
		// workflows (parallel-research, research, pipeline) from emitting their
		// declared `output:` files. 3/3 workflows use writer for deliverable
		// creation, not for read-only docs review. Audit confirmed.
		// See: research-findings/pi-crew-parallel-research-failure-incident.md
		assert.strictEqual(permissionForRole("writer"), "workspace_write");
	});

	it("returns 'workspace_write' for executor", () => {
		assert.strictEqual(permissionForRole("executor"), "workspace_write");
	});

	it("returns 'workspace_write' for test-engineer", () => {
		assert.strictEqual(permissionForRole("test-engineer"), "workspace_write");
	});

	it("returns 'workspace_write' for unknown role", () => {
		assert.strictEqual(permissionForRole("unknown-role"), "workspace_write");
	});
});

// ── isReadOnlyCommand ───────────────────────────────────────────────────

describe("isReadOnlyCommand", () => {
	it("returns true for simple read commands", () => {
		assert.strictEqual(isReadOnlyCommand("ls -la"), true);
		assert.strictEqual(isReadOnlyCommand("cat file.txt"), true);
		assert.strictEqual(isReadOnlyCommand("grep pattern file"), true);
		assert.strictEqual(isReadOnlyCommand("find . -name '*.ts'"), true);
	});

	it("returns true for git read-only commands", () => {
		assert.strictEqual(isReadOnlyCommand("git status"), true);
		assert.strictEqual(isReadOnlyCommand("git log --oneline"), true);
		assert.strictEqual(isReadOnlyCommand("git diff HEAD"), true);
	});

	it("returns false for write-indicating commands", () => {
		assert.strictEqual(isReadOnlyCommand("rm -rf /tmp/test"), false);
		assert.strictEqual(isReadOnlyCommand("npm install"), false);
		assert.strictEqual(isReadOnlyCommand("git commit -m 'x'"), false);
	});

	it("returns false for redirect commands", () => {
		assert.strictEqual(isReadOnlyCommand("echo hi > file.txt"), false);
	});

	it("returns false for in-place sed", () => {
		assert.strictEqual(isReadOnlyCommand("sed -i 's/old/new/g' file"), false);
	});

	it("handles paths with slashes in command name", () => {
		assert.strictEqual(isReadOnlyCommand("/usr/bin/ls"), true);
		assert.strictEqual(isReadOnlyCommand("/usr/local/bin/git status"), true);
	});

	it("returns false for mv and cp in the regex", () => {
		assert.strictEqual(isReadOnlyCommand("mv a b"), false);
		assert.strictEqual(isReadOnlyCommand("cp a b"), false);
	});
});

// ── checkRolePermission ─────────────────────────────────────────────────

describe("checkRolePermission", () => {
	it("allows read-only role with read-only command", () => {
		const result = checkRolePermission("explorer", "cat file.txt");
		assert.strictEqual(result.allowed, true);
		assert.strictEqual(result.mode, "read_only");
	});

	it("denies read-only role with write command", () => {
		const result = checkRolePermission("explorer", "npm install");
		assert.strictEqual(result.allowed, false);
		assert.strictEqual(result.mode, "read_only");
		assert.ok(result.reason?.includes("read-only"));
	});

	it("allows write role with any command", () => {
		const result = checkRolePermission("executor", "npm install");
		assert.strictEqual(result.allowed, true);
		assert.strictEqual(result.mode, "workspace_write");
	});

	it("denies access to sensitive paths even for write roles", () => {
		const result = checkRolePermission("executor", "cat", "/home/user/.ssh/id_rsa");
		assert.strictEqual(result.allowed, false);
		assert.ok(result.reason?.includes("sensitive"));
	});

	it("denies access to sensitive paths for read-only roles", () => {
		const result = checkRolePermission("explorer", "cat", "/home/user/.ssh/id_rsa");
		assert.strictEqual(result.allowed, false);
		assert.ok(result.reason?.includes("sensitive"));
	});

	it("allows when no filePath is provided", () => {
		const result = checkRolePermission("executor", "echo hello");
		assert.strictEqual(result.allowed, true);
	});
});

// ── currentCrewRole ─────────────────────────────────────────────────────

describe("currentCrewRole", () => {
	it("returns undefined when no env vars set", () => {
		assert.strictEqual(currentCrewRole({}), undefined);
	});

	it("reads from PI_CREW_ROLE", () => {
		assert.strictEqual(currentCrewRole({ PI_CREW_ROLE: "explorer" }), "explorer");
	});

	it("reads from PI_TEAMS_ROLE as fallback", () => {
		assert.strictEqual(currentCrewRole({ PI_TEAMS_ROLE: "executor" }), "executor");
	});

	it("PI_CREW_ROLE takes precedence over PI_TEAMS_ROLE", () => {
		assert.strictEqual(
			currentCrewRole({ PI_CREW_ROLE: "explorer", PI_TEAMS_ROLE: "executor" }),
			"explorer",
		);
	});

	it("trims whitespace from role", () => {
		assert.strictEqual(currentCrewRole({ PI_CREW_ROLE: "  executor  " }), "executor");
	});

	it("returns undefined for empty string after trim", () => {
		assert.strictEqual(currentCrewRole({ PI_CREW_ROLE: "   " }), undefined);
	});
});

// ── checkSubagentSpawnPermission ────────────────────────────────────────

describe("checkSubagentSpawnPermission", () => {
	it("allows when role is undefined", () => {
		const result = checkSubagentSpawnPermission(undefined);
		assert.strictEqual(result.allowed, true);
	});

	it("denies for read-only roles", () => {
		const result = checkSubagentSpawnPermission("explorer");
		assert.strictEqual(result.allowed, false);
		assert.strictEqual(result.mode, "read_only");
		assert.ok(result.reason?.includes("read-only"));
	});

	it("allows for write roles", () => {
		const result = checkSubagentSpawnPermission("executor");
		assert.strictEqual(result.allowed, true);
		assert.strictEqual(result.mode, "workspace_write");
	});

	it("allows for test-engineer", () => {
		const result = checkSubagentSpawnPermission("test-engineer");
		assert.strictEqual(result.allowed, true);
	});

	it("denies for reviewer", () => {
		const result = checkSubagentSpawnPermission("reviewer");
		assert.strictEqual(result.allowed, false);
	});
});
