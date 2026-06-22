/**
 * Phase 1.5 worker-thread atomic writer unit tests.
 * RFC: research-findings/goal-workflow/15-PHASE1.5-WORKER-WRITER-RFC.md
 */
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
	isWorkerAtomicWriterEnabled,
	atomicWriteFileViaWorker,
	appendFileViaWorker,
	terminateWorkerAtomicWriter,
	__setKeepWorkerRefForTests,
} from "../../src/state/worker-atomic-writer.ts";

// Keep worker ref'd for the WHOLE suite so the test runner doesn't exit before
// promises resolve. Production code keeps worker unref'd.
__setKeepWorkerRefForTests(true);

function tmpFile(): { dir: string; file: string } {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-waw-test-"));
	return { dir, file: path.join(dir, "test.txt") };
}

test("isWorkerAtomicWriterEnabled: defaults to false (opt-in)", () => {
	__setKeepWorkerRefForTests(true);
	const saved = process.env.PI_CREW_WORKER_ATOMIC_WRITER;
	delete process.env.PI_CREW_WORKER_ATOMIC_WRITER;
	delete process.env.PI_TEAMS_WORKER_ATOMIC_WRITER;
	assert.equal(isWorkerAtomicWriterEnabled(), false);
	if (saved) process.env.PI_CREW_WORKER_ATOMIC_WRITER = saved;
});

test("isWorkerAtomicWriterEnabled: true when PI_CREW_WORKER_ATOMIC_WRITER=1", () => {
	const saved = process.env.PI_CREW_WORKER_ATOMIC_WRITER;
	process.env.PI_CREW_WORKER_ATOMIC_WRITER = "1";
	assert.equal(isWorkerAtomicWriterEnabled(), true);
	if (saved) process.env.PI_CREW_WORKER_ATOMIC_WRITER = saved;
	else delete process.env.PI_CREW_WORKER_ATOMIC_WRITER;
});

test("atomicWriteFileViaWorker: writes file content", async () => {
	const { dir, file } = tmpFile();
	try {
		await atomicWriteFileViaWorker(file, "hello world\n");
		assert.equal(fs.readFileSync(file, "utf-8"), "hello world\n");
	} finally {
		terminateWorkerAtomicWriter();
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("atomicWriteFileViaWorker: overwrites existing file", async () => {
	const { dir, file } = tmpFile();
	try {
		await atomicWriteFileViaWorker(file, "first\n");
		await atomicWriteFileViaWorker(file, "second\n");
		assert.equal(fs.readFileSync(file, "utf-8"), "second\n");
	} finally {
		terminateWorkerAtomicWriter();
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("atomicWriteFileViaWorker: creates nested dirs", async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-waw-test-"));
	const nested = path.join(dir, "a", "b", "c", "test.txt");
	try {
		await atomicWriteFileViaWorker(nested, "nested content\n");
		assert.equal(fs.readFileSync(nested, "utf-8"), "nested content\n");
	} finally {
		terminateWorkerAtomicWriter();
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("atomicWriteFileViaWorker: handles parallel writes to DIFFERENT files", async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-waw-test-"));
	try {
		const files = Array.from({ length: 10 }, (_, i) => path.join(dir, `f${i}.txt`));
		await Promise.all(files.map((f, i) => atomicWriteFileViaWorker(f, `content-${i}\n`)));
		for (const [i, f] of files.entries()) {
			assert.equal(fs.readFileSync(f, "utf-8"), `content-${i}\n`);
		}
	} finally {
		terminateWorkerAtomicWriter();
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("appendFileViaWorker: appends to existing file", async () => {
	const { dir, file } = tmpFile();
	try {
		fs.writeFileSync(file, "first\n", "utf-8");
		await appendFileViaWorker(file, "second\n");
		assert.equal(fs.readFileSync(file, "utf-8"), "first\nsecond\n");
	} finally {
		terminateWorkerAtomicWriter();
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("appendFileViaWorker: creates file if missing", async () => {
	const { dir, file } = tmpFile();
	try {
		await appendFileViaWorker(file, "appended\n");
		assert.equal(fs.readFileSync(file, "utf-8"), "appended\n");
	} finally {
		terminateWorkerAtomicWriter();
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("terminateWorkerAtomicWriter: subsequent write spawns fresh worker", async () => {
	const { dir, file } = tmpFile();
	try {
		await atomicWriteFileViaWorker(file, "before terminate\n");
		terminateWorkerAtomicWriter();
		await atomicWriteFileViaWorker(file, "after terminate\n");
		assert.equal(fs.readFileSync(file, "utf-8"), "after terminate\n");
	} finally {
		terminateWorkerAtomicWriter();
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
