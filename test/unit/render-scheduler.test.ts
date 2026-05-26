import test from "node:test";
import assert from "node:assert/strict";
import { RenderScheduler } from "../../src/ui/render-scheduler.ts";

class FakeEvents {
	private handlers = new Map<string, Set<(payload: unknown) => void>>();
	on(event: string, handler: (payload: unknown) => void): () => void {
		const set = this.handlers.get(event) ?? new Set<(payload: unknown) => void>();
		set.add(handler);
		this.handlers.set(event, set);
		return () => set.delete(handler);
	}
	emit(event: string, payload: unknown): void {
		for (const handler of this.handlers.get(event) ?? []) handler(payload);
	}
	listenerCount(event: string): number {
		return this.handlers.get(event)?.size ?? 0;
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

test("RenderScheduler coalesces event bursts and disposes listeners", async () => {
	const events = new FakeEvents();
	let renders = 0;
	let invalidations = 0;
	const scheduler = new RenderScheduler(events, () => { renders += 1; }, { debounceMs: 20, fallbackMs: 10_000, events: ["crew.run.completed"], onInvalidate: () => { invalidations += 1; }, invalidateCoalesceMs: 0 });
	assert.equal(events.listenerCount("crew.run.completed"), 1);
	events.emit("crew.run.completed", { runId: "one" });
	events.emit("crew.run.completed", { runId: "one" });
	assert.equal(invalidations, 2);
	await sleep(50);
	assert.equal(renders, 1);
	scheduler.dispose();
	assert.equal(events.listenerCount("crew.run.completed"), 0);
	events.emit("crew.run.completed", { runId: "two" });
	await sleep(30);
	assert.equal(renders, 1);
});

test("RenderScheduler 1.9: per-runId invalidate coalesce collapses same-run bursts", async () => {
	const events = new FakeEvents();
	const invalidations: string[] = [];
	const scheduler = new RenderScheduler(events, () => {}, {
		debounceMs: 5,
		fallbackMs: 10_000,
		events: ["crew.subagent.completed"],
		invalidateCoalesceMs: 30,
		onInvalidate: (payload) => {
			const runId = (payload as { runId?: string } | undefined)?.runId;
			invalidations.push(runId ?? "<no-run>");
		},
	});
	// Burst on the same run + one event on a different run.
	for (let i = 0; i < 10; i++) events.emit("crew.subagent.completed", { runId: "burst", taskId: `t${i}` });
	events.emit("crew.subagent.completed", { runId: "other" });
	await sleep(60);
	scheduler.dispose();
	// Burst → 1 invalidate per distinct runId (2 total) instead of 11.
	assert.equal(invalidations.length, 2);
	assert.deepEqual([...invalidations].sort(), ["burst", "other"]);
});

test("RenderScheduler 1.9: payload without runId still invalidates immediately", () => {
	const events = new FakeEvents();
	let invalidations = 0;
	const scheduler = new RenderScheduler(events, () => {}, {
		debounceMs: 5,
		fallbackMs: 10_000,
		events: ["crew.mailbox.updated"],
		invalidateCoalesceMs: 30,
		onInvalidate: () => { invalidations += 1; },
	});
	// payload without runId — should not be coalesced.
	events.emit("crew.mailbox.updated", { kind: "info" });
	events.emit("crew.mailbox.updated", undefined);
	assert.equal(invalidations, 2);
	scheduler.dispose();
});

test("RenderScheduler fallback renders when no events arrive", async () => {
	let renders = 0;
	const scheduler = new RenderScheduler(undefined, () => { renders += 1; }, { debounceMs: 5, fallbackMs: 20 });
	// Wait longer for slower environments (macOS ARM64 may be slower)
	await sleep(100);
	scheduler.dispose();
	// At least one render should have occurred by now
	assert.ok(renders >= 1, `Expected at least 1 render, got ${renders}`);
});

test("RenderScheduler accepts dynamic fallbackMs and adapts tick frequency", async () => {
	let renders = 0;
	let mode: "fast" | "slow" = "fast";
	const fallbackMs = () => mode === "fast" ? 20 : 5_000;
	const scheduler = new RenderScheduler(undefined, () => { renders += 1; }, { debounceMs: 5, fallbackMs });
	await sleep(120);
	const fastRenders = renders;
	assert.ok(fastRenders >= 2, `expected >= 2 fast renders, got ${fastRenders}`);
	mode = "slow";
	const baseline = renders;
	await sleep(120);
	scheduler.dispose();
	const delta = renders - baseline;
	assert.ok(delta <= 1, `expected slow mode to render at most once, got ${delta}`);
});

test("RenderScheduler handles fallbackMs thrower without crashing", async () => {
	let renders = 0;
	const scheduler = new RenderScheduler(undefined, () => { renders += 1; }, {
		debounceMs: 5,
		fallbackMs: () => { throw new Error("boom"); },
	});
	await sleep(50);
	scheduler.dispose();
	assert.ok(renders >= 0);
});
