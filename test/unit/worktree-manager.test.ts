import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { prepareTaskWorkspace, findGitRoot, assertCleanLeader } from "../../src/worktree/worktree-manager.ts";
import type { TeamRunManifest, TeamTaskState } from "../../src/state/types.ts";

function makeRepoTemp(prefix: string): string {
	let dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	try { dir = fs.realpathSync(dir); } catch { /* keep */ }
	return dir;
}

function initGitRepo(dir: string) {
	execFileSync("git", ["init", "-q", "--initial-branch=main"], { cwd: dir });
	fs.writeFileSync(path.join(dir, ".gitignore"), ".crew\n", "utf-8");
	execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", ".gitignore"], { cwd: dir });
	execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"], { cwd: dir });
}

function minimalManifest(cwd: string, runId: string): TeamRunManifest {
	return {
		schemaVersion: 1,
		runId,
		team: "test-team",
		workflow: "test-workflow",
		goal: "test",
		status: "running",
		workspaceMode: "worktree",
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		cwd,
		stateRoot: path.join(cwd, ".crew", "state", "runs", runId),
		artifactsRoot: path.join(cwd, ".crew", "artifacts", runId),
		tasksPath: "tasks.json",
		eventsPath: "events.jsonl",
		artifacts: [],
	};
}

function minimalTask(id: string, cwd: string): TeamTaskState {
	return {
		id,
		agent: "explorer",
		status: "waiting",
		role: "explorer",
		title: "Test task",
		dependsOn: [],
		cwd,
		runId: "run_test",
	};
}

test("prepareTaskWorkspace recovers when branch exists but worktree dir is gone", () => {
	const repo = makeRepoTemp("pi-crew-wt-");
	initGitRepo(repo);
	// Pre-create the branch (simulating leftover from crashed run)
	execFileSync("git", ["branch", "pi-crew/run1/task1"], { cwd: repo });
	const manifest = minimalManifest(repo, "run1");
	const task = minimalTask("task1", repo);
	const result = prepareTaskWorkspace(manifest, task);
	assert.ok(result.worktreePath);
	assert.equal(result.branch, "pi-crew/run1/task1");
	// Cleanup
	fs.rmSync(repo, { recursive: true, force: true });
});

test("prepareTaskWorkspace reuses existing valid worktree", () => {
	const repo = makeRepoTemp("pi-crew-wt-");
	initGitRepo(repo);
	const manifest = minimalManifest(repo, "run2");
	const task = minimalTask("task2", repo);
	const first = prepareTaskWorkspace(manifest, task);
	assert.ok(first.worktreePath);
	assert.equal(first.reused, false);
	const second = prepareTaskWorkspace(manifest, task);
	assert.equal(second.reused, true);
	assert.equal(second.worktreePath, first.worktreePath);
	// Cleanup
	fs.rmSync(repo, { recursive: true, force: true });
});

test("prepareTaskWorkspace skips linkNodeModules when source is a file", () => {
	const repo = makeRepoTemp("pi-crew-wt-fn-");
	initGitRepo(repo);
	// Place a FILE at node_modules instead of a directory, then commit it so repo is clean
	fs.writeFileSync(path.join(repo, "node_modules"), "not a dir", "utf-8");
	execFileSync("git", ["add", "node_modules"], { cwd: repo });
	execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "add nm"], { cwd: repo });
	// Write project config to enable linkNodeModules
	const cfgDir = path.join(repo, ".crew");
	fs.mkdirSync(cfgDir, { recursive: true });
	fs.writeFileSync(path.join(cfgDir, "config.json"), JSON.stringify({
		worktree: { linkNodeModules: true },
	}), "utf-8");
	const manifest = minimalManifest(repo, "run-fn");
	const task = minimalTask("task-fn", repo);
	const result = prepareTaskWorkspace(manifest, task);
	assert.equal(result.nodeModulesLinked, false);
	fs.rmSync(repo, { recursive: true, force: true });
});

test("assertCleanLeader throws when repo has uncommitted changes", () => {
	const repo = makeRepoTemp("pi-crew-wt-");
	initGitRepo(repo);
	fs.writeFileSync(path.join(repo, "dirty.txt"), "x", "utf-8");
	assert.throws(() => assertCleanLeader(repo), /clean leader/);
	// Cleanup
	fs.rmSync(repo, { recursive: true, force: true });
});

test("setupHook never uses shell:true regardless of platform (C3 security fix)", async () => {
	// Regression guard: verify the source code never sets useShell to a truthy value.
	// Since ESM module exports are frozen and cannot be mocked at runtime,
	// we verify the security invariant by inspecting the source directly.
	const source = fs.readFileSync(
		path.resolve(import.meta.dirname, "../../src/worktree/worktree-manager.ts"),
		"utf-8",
	);

	// Verify useShell is hardcoded to false
	const useShellMatch = source.match(/const useShell\s*=\s*([^;]+);/);
	assert.ok(useShellMatch, "Could not find 'const useShell = ...' in worktree-manager.ts");
	assert.equal(useShellMatch![1].trim(), "false",
		`Expected useShell to be hardcoded to 'false', but got: '${useShellMatch![1].trim()}'`);

	// Verify the old vulnerable pattern is gone from the useShell assignment
	const vulnerablePattern = /const\s+useShell\s*=\s*process\.platform\s*===\s*["']win32["']\s*&&\s*!nodeHook/;
	assert.ok(!vulnerablePattern.test(source),
		"Old vulnerable pattern 'const useShell = process.platform === 'win32' && !nodeHook' still present in source");

	// Extract the runSetupHook function section for further checks
	const hookSection = source.substring(source.indexOf("function runSetupHook"));

	// Verify shell:true is not used as an actual option value in spawn calls
	// Strip comment lines and string literals mentioning shell:true to avoid false positives
	const codeOnly = hookSection.split("\n")
		.filter((line) => !line.trim().startsWith("//"))
		.join("\n");
	const codeNoStrings = codeOnly.replace(/"[^"]*shell:true[^"]*"/g, '""');
	const shellTrueInCode = /shell:\s*true/.test(codeNoStrings);
	assert.ok(!shellTrueInCode, "Found 'shell: true' as an actual option value in runSetupHook — security vulnerability present");

	// Verify .bat/.cmd path still uses cmd.exe /c
	assert.ok(hookSection.includes('"cmd.exe"'), ".bat/.cmd handling via cmd.exe is preserved");
	assert.ok(hookSection.includes('shell: false'), "Batch file spawn uses shell: false");

	// Verify node hook handling is preserved
	assert.ok(hookSection.includes("process.execPath"), "Node hook handling via process.execPath is preserved");
});
