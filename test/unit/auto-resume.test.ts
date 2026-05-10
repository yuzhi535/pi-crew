import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { AutoResumeController, SETTLE_WINDOW_MS, MAX_AUTORESUME_TURNS } from "../../src/runtime/auto-resume.ts";

describe("SETTLE_WINDOW_MS", () => {
	it("is 800ms", () => {
		assert.equal(SETTLE_WINDOW_MS, 800);
	});
});

describe("MAX_AUTORESUME_TURNS", () => {
	it("is 20", () => {
		assert.equal(MAX_AUTORESUME_TURNS, 20);
	});
});

describe("AutoResumeController", () => {
	let controller: AutoResumeController;

	beforeEach(() => {
		controller = new AutoResumeController();
	});

	afterEach(() => {
		controller.cancelResume();
	});

	it("starts with no pending resume", () => {
		assert.equal(controller.hasPendingResume(), false);
		assert.equal(controller.currentTurnCount, 0);
	});

	it("has pending resume after scheduling", () => {
		controller.scheduleResume("test", () => {});
		assert.equal(controller.hasPendingResume(), true);
		assert.equal(controller.currentTurnCount, 1);
	});

	it("calls callback after settle window", async () => {
		let called = false;
		controller.scheduleResume("test", () => {
			called = true;
		});

		// Wait slightly longer than settle window
		await new Promise((resolve) => setTimeout(resolve, SETTLE_WINDOW_MS + 100));

		assert.equal(called, true);
		assert.equal(controller.hasPendingResume(), false);
	});

	it("cancels pending resume", () => {
		controller.scheduleResume("test", () => {});
		assert.equal(controller.hasPendingResume(), true);

		controller.cancelResume();
		assert.equal(controller.hasPendingResume(), false);
	});

	it("does not call callback after cancellation", async () => {
		let called = false;
		controller.scheduleResume("test", () => {
			called = true;
		});
		controller.cancelResume();

		await new Promise((resolve) => setTimeout(resolve, SETTLE_WINDOW_MS + 100));
		assert.equal(called, false);
	});

	it("debounces: scheduling again cancels previous", async () => {
		let firstCalled = false;
		let secondCalled = false;

		controller.scheduleResume("first", () => {
			firstCalled = true;
		});
		controller.scheduleResume("second", () => {
			secondCalled = true;
		});

		await new Promise((resolve) => setTimeout(resolve, SETTLE_WINDOW_MS + 100));

		assert.equal(firstCalled, false);
		assert.equal(secondCalled, true);
		assert.equal(controller.currentTurnCount, 2);
	});

	it("respects turn limit", () => {
		const controller2 = new AutoResumeController();
		// Exhaust turn limit
		for (let i = 0; i < MAX_AUTORESUME_TURNS; i++) {
			controller2.scheduleResume(`turn-${i}`, () => {});
			controller2.cancelResume(); // Cancel immediately to not affect next schedule
			// But turn count is still incremented
		}
		controller2.cancelResume();

		// Now scheduling should be a no-op
		let called = false;
		controller2.scheduleResume("overflow", () => {
			called = true;
		});
		assert.equal(controller2.hasPendingResume(), false);
		assert.equal(called, false);
	});

	it("resetTurnCount allows scheduling again", () => {
		const controller2 = new AutoResumeController();
		// Set turn count to max
		for (let i = 0; i < MAX_AUTORESUME_TURNS; i++) {
			controller2.scheduleResume(`turn-${i}`, () => {});
			controller2.cancelResume();
		}
		controller2.cancelResume();

		// Should be blocked
		controller2.scheduleResume("blocked", () => {});
		assert.equal(controller2.hasPendingResume(), false);

		// Reset and try again
		controller2.resetTurnCount();
		assert.equal(controller2.currentTurnCount, 0);

		controller2.scheduleResume("after-reset", () => {});
		assert.equal(controller2.hasPendingResume(), true);
		controller2.cancelResume();
	});

	it("maxTurns property returns MAX_AUTORESUME_TURNS", () => {
		assert.equal(controller.maxTurns, MAX_AUTORESUME_TURNS);
	});
});
