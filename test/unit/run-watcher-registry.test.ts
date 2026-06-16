/**
 * RunWatcherRegistry — bounded per-run watcher registry (pts/2 hang fix).
 *
 * The registry replaces the recursive fs.watch(<state>, {recursive:true}) that
 * exploded to O(total run history) inotify watches on Linux, with O(active
 * runs) non-recursive per-run watchers plus a single root watcher for new-run
 * detection.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { RunWatcherRegistry } from "../../src/utils/run-watcher-registry.ts";

function tmpRoot(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-rwr-"));
}
function makeRunDir(root: string, runId: string): string {
	const d = path.join(root, "runs", runId);
	fs.mkdirSync(d, { recursive: true });
	return d;
}

describe("RunWatcherRegistry — lifecycle", () => {
	let root: string;
	let reg: RunWatcherRegistry;
	beforeEach(() => {
		root = tmpRoot();
		fs.mkdirSync(path.join(root, "runs"), { recursive: true });
		reg = new RunWatcherRegistry();
	});
	afterEach(() => {
		reg.closeAll();
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("starts empty (size 0)", () => {
		assert.equal(reg.size, 0);
	});

	it("addRunWatcher increments size and hasWatcher reports true", () => {
		const dir = makeRunDir(root, "run_a");
		const ok = reg.addRunWatcher("run_a", dir, () => {});
		assert.equal(ok, true);
		assert.equal(reg.size, 1);
		assert.equal(reg.hasWatcher("run_a"), true);
		assert.equal(reg.hasWatcher("run_b"), false);
	});

	it("addRunWatcher replaces an existing watcher (no size leak)", () => {
		const dir = makeRunDir(root, "run_a");
		reg.addRunWatcher("run_a", dir, () => {});
		assert.equal(reg.size, 1);
		reg.addRunWatcher("run_a", dir, () => {});
		assert.equal(reg.size, 1); // replaced, not duplicated
	});

	it("removeRunWatcher decrements size and is a no-op when absent", () => {
		const dir = makeRunDir(root, "run_a");
		reg.addRunWatcher("run_a", dir, () => {});
		reg.removeRunWatcher("run_a");
		assert.equal(reg.size, 0);
		assert.equal(reg.hasWatcher("run_a"), false);
		// no-op
		reg.removeRunWatcher("run_a");
		assert.equal(reg.size, 0);
	});

	it("closeAll clears everything and is idempotent", () => {
		makeRunDir(root, "run_a");
		makeRunDir(root, "run_b");
		reg.addRunWatcher("run_a", path.join(root, "runs", "run_a"), () => {});
		reg.addRunWatcher("run_b", path.join(root, "runs", "run_b"), () => {});
		reg.closeAll();
		assert.equal(reg.size, 0);
		reg.closeAll(); // idempotent
		assert.equal(reg.size, 0);
	});

	it("addRunWatcher after closeAll is a no-op", () => {
		reg.closeAll();
		const dir = makeRunDir(root, "run_a");
		const ok = reg.addRunWatcher("run_a", dir, () => {});
		assert.equal(ok, false);
		assert.equal(reg.size, 0);
	});
});

describe("RunWatcherRegistry — reconcile", () => {
	let root: string;
	let reg: RunWatcherRegistry;
	beforeEach(() => {
		root = tmpRoot();
		fs.mkdirSync(path.join(root, "runs"), { recursive: true });
		reg = new RunWatcherRegistry();
	});
	afterEach(() => {
		reg.closeAll();
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("reconcile adds watchers for all active runs", () => {
		const a = makeRunDir(root, "run_a");
		const b = makeRunDir(root, "run_b");
		const res = reg.reconcile(
			[{ runId: "run_a", runDir: a }, { runId: "run_b", runDir: b }],
			() => {},
		);
		assert.deepEqual(res.added.sort(), ["run_a", "run_b"]);
		assert.deepEqual(res.removed, []);
		assert.equal(reg.size, 2);
	});

	it("reconcile removes watchers for runs that left the active set", () => {
		const a = makeRunDir(root, "run_a");
		const b = makeRunDir(root, "run_b");
		reg.reconcile([{ runId: "run_a", runDir: a }, { runId: "run_b", runDir: b }], () => {});
		// run_b completes → leaves active set
		const res = reg.reconcile([{ runId: "run_a", runDir: a }], () => {});
		assert.deepEqual(res.added, []);
		assert.deepEqual(res.removed, ["run_b"]);
		assert.equal(reg.size, 1);
		assert.equal(reg.hasWatcher("run_b"), false);
	});

	it("reconcile is idempotent when the active set is unchanged", () => {
		const a = makeRunDir(root, "run_a");
		reg.reconcile([{ runId: "run_a", runDir: a }], () => {});
		const res = reg.reconcile([{ runId: "run_a", runDir: a }], () => {});
		assert.deepEqual(res.added, []);
		assert.deepEqual(res.removed, []);
		assert.equal(reg.size, 1);
	});

	it("reconcile with empty active set removes all watchers", () => {
		const a = makeRunDir(root, "run_a");
		reg.reconcile([{ runId: "run_a", runDir: a }], () => {});
		const res = reg.reconcile([], () => {});
		assert.deepEqual(res.removed, ["run_a"]);
		assert.equal(reg.size, 0);
	});
});

describe("RunWatcherRegistry — root watcher detects new run dirs", () => {
	let root: string;
	let reg: RunWatcherRegistry;
	beforeEach(() => {
		root = tmpRoot();
		fs.mkdirSync(path.join(root, "runs"), { recursive: true });
		reg = new RunWatcherRegistry();
	});
	afterEach(() => {
		reg.closeAll();
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("setRootWatcher fires onNewRun when a new run dir is created", (_, done) => {
		const seen = new Set<string>();
		reg.setRootWatcher(path.join(root, "runs"), (runId) => {
			seen.add(runId);
			if (seen.has("run_new")) {
				assert.ok(seen.has("run_new"), `root watcher saw new run: ${runId}`);
				done();
			}
		});
		// Create a new run directory — the root watcher should report it.
		fs.mkdirSync(path.join(root, "runs", "run_new"), { recursive: true });
		// Touch a file inside to ensure an event is delivered (some platforms
		// only fire on file create, not dir create).
		fs.writeFileSync(path.join(root, "runs", "run_new", "manifest.json"), "{}");
	});
});

describe("RunWatcherRegistry — per-run watcher fires onChange", () => {
	let root: string;
	let reg: RunWatcherRegistry;
	beforeEach(() => {
		root = tmpRoot();
		fs.mkdirSync(path.join(root, "runs"), { recursive: true });
		reg = new RunWatcherRegistry();
	});
	afterEach(() => {
		reg.closeAll();
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("addRunWatcher fires onChange when the watched run dir changes", (_, done) => {
		const dir = makeRunDir(root, "run_active");
		reg.addRunWatcher("run_active", dir, () => {
			done();
		});
		// Modify a file in the run dir → watcher should fire.
		fs.writeFileSync(path.join(dir, "manifest.json"), "{}");
	});
});
