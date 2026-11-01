import { describe, expect, test } from "bun:test";
import { advance, createAccumulator, createClock } from "../src/clock";

function fakeClock(startMs = 0) {
	let nowMs = startMs;
	return {
		now: () => nowMs,
		tick(ms: number) {
			nowMs += ms;
		},
	};
}

describe("advance", () => {
	test("runs one step per stepMs and carries the remainder into the next advance", () => {
		const accumulator = createAccumulator(100, 50);

		const early = advance(accumulator, 99);
		const carriedAfterEarly = accumulator.carriedMs;
		const first = advance(accumulator, 151);
		const carriedAfterFirst = accumulator.carriedMs;
		const second = advance(accumulator, 50);

		expect(early).toBe(0);
		expect(carriedAfterEarly).toBe(99);
		expect(first).toBe(2);
		expect(carriedAfterFirst).toBe(50);
		expect(second).toBe(1);
		expect(accumulator.carriedMs).toBe(0);
	});

	test("drops time beyond the cap and keeps only the sub-step remainder", () => {
		const accumulator = createAccumulator(100, 50);
		const oneHourMs = 3_600_000;

		const steps = advance(accumulator, oneHourMs + 30);

		expect(steps).toBe(50);
		expect(accumulator.droppedMs).toBeCloseTo(oneHourMs - 50 * 100, 6);
		expect(accumulator.carriedMs).toBeCloseTo(30, 6);
	});

	test("does not drop time when the cap is not exceeded", () => {
		const accumulator = createAccumulator(100, 50);

		advance(accumulator, 5000);

		expect(accumulator.droppedMs).toBe(0);
	});

	test.each([-500, Number.NaN])(
		"treats elapsed time of %p as zero without changing state",
		(elapsedMs) => {
			const accumulator = createAccumulator(100, 50);
			advance(accumulator, 40);

			const steps = advance(accumulator, elapsedMs);

			expect(steps).toBe(0);
			expect(accumulator.carriedMs).toBe(40);
			expect(accumulator.droppedMs).toBe(0);
		},
	);

	test.each([
		[1000 / 60, 60_000, 10_000],
		[0.1, 10_000, 10],
	])(
		"frames of %p ms neither lose nor gain a step over a long run",
		(frameMs, frames, expectedSteps) => {
			const accumulator = createAccumulator(100, 50);
			let total = 0;

			for (let frame = 0; frame < frames; frame++) {
				total += advance(accumulator, frameMs);
			}

			expect(total).toBe(expectedSteps);
			expect(accumulator.droppedMs).toBe(0);
		},
	);
});

describe("createAccumulator", () => {
	test("starts with nothing carried or dropped", () => {
		expect(createAccumulator(100, 50)).toEqual({
			stepMs: 100,
			maxStepsPerFrame: 50,
			carriedMs: 0,
			droppedMs: 0,
		});
	});

	test.each([
		[0, 50],
		[-100, 50],
		[Number.NaN, 50],
		[Number.POSITIVE_INFINITY, 50],
		[100, 0],
		[100, -1],
		[100, 1.5],
	])("rejects stepMs %p with maxStepsPerFrame %p", (stepMs, maxSteps) => {
		expect(() => createAccumulator(stepMs, maxSteps)).toThrow(RangeError);
	});
});

describe("createClock", () => {
	test("first frame establishes the baseline and returns 0", () => {
		const time = fakeClock(123_456);
		const clock = createClock({
			stepMs: 100,
			maxStepsPerFrame: 50,
			now: time.now,
		});

		expect(clock.frame()).toBe(0);
		expect(clock.accumulator.carriedMs).toBe(0);
	});

	test("later frames return steps for the time since the previous frame, and a backward jump yields 0 then resumes", () => {
		const time = fakeClock(10_000);
		const clock = createClock({
			stepMs: 100,
			maxStepsPerFrame: 50,
			now: time.now,
		});
		clock.frame();

		time.tick(250);
		const forward = clock.frame();
		time.tick(-5000);
		const backward = clock.frame();
		time.tick(150);
		const resumed = clock.frame();

		expect(forward).toBe(2);
		expect(backward).toBe(0);
		expect(resumed).toBe(2);
	});

	test("defaults to performance.now when no time source is given", () => {
		const clock = createClock({ stepMs: 100, maxStepsPerFrame: 50 });

		expect(clock.frame()).toBe(0);
		expect(clock.frame()).toBeGreaterThanOrEqual(0);
	});
});
