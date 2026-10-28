import { describe, expect, test } from "bun:test";
import {
	advance,
	createAccumulator,
	createClock,
	DEFAULT_MAX_STEPS_PER_FRAME,
} from "../src/clock";

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
	test("runs exactly one step per stepMs", () => {
		const accumulator = createAccumulator(100, 50);

		const steps = advance(accumulator, 100);

		expect(steps).toBe(1);
		expect(accumulator.carriedMs).toBe(0);
	});

	test("runs no step before stepMs has elapsed", () => {
		const accumulator = createAccumulator(100, 50);

		const steps = advance(accumulator, 99);

		expect(steps).toBe(0);
		expect(accumulator.carriedMs).toBe(99);
	});

	test("carries the remainder into the next advance", () => {
		const accumulator = createAccumulator(100, 50);

		const first = advance(accumulator, 250);
		const carriedAfterFirst = accumulator.carriedMs;
		const second = advance(accumulator, 50);

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
		expect(accumulator.carriedMs).toBeLessThan(accumulator.stepMs);
	});

	test("does not drop time when the cap is not exceeded", () => {
		const accumulator = createAccumulator(100, 50);

		advance(accumulator, 5000);

		expect(accumulator.droppedMs).toBe(0);
	});

	test("treats backward elapsed time as zero without changing state", () => {
		const accumulator = createAccumulator(100, 50);
		advance(accumulator, 40);

		const steps = advance(accumulator, -500);

		expect(steps).toBe(0);
		expect(accumulator.carriedMs).toBe(40);
		expect(accumulator.droppedMs).toBe(0);
	});

	test("treats NaN elapsed time as zero without changing state", () => {
		const accumulator = createAccumulator(100, 50);
		advance(accumulator, 40);

		const steps = advance(accumulator, Number.NaN);

		expect(steps).toBe(0);
		expect(accumulator.carriedMs).toBe(40);
		expect(accumulator.droppedMs).toBe(0);
	});

	test("60 fps frames over 10 simulated seconds produce exactly 100 steps", () => {
		const accumulator = createAccumulator(100, 50);
		let total = 0;

		for (let frame = 0; frame < 600; frame++) {
			total += advance(accumulator, 1000 / 60);
		}

		expect(total).toBe(100);
		expect(accumulator.carriedMs).toBeLessThan(1e-6);
	});

	test("many fractional frames neither lose nor gain a step over a long run", () => {
		const accumulator = createAccumulator(100, 50);
		let total = 0;

		for (let frame = 0; frame < 60_000; frame++) {
			total += advance(accumulator, 1000 / 60);
		}

		expect(total).toBe(10_000);
		expect(accumulator.droppedMs).toBe(0);
	});

	test("0.1 ms increments sum to whole steps without float loss", () => {
		const accumulator = createAccumulator(100, 50);
		let total = 0;

		for (let i = 0; i < 10_000; i++) {
			total += advance(accumulator, 0.1);
		}

		expect(total).toBe(10);
	});
});

describe("createAccumulator", () => {
	test("starts with nothing carried or dropped", () => {
		const accumulator = createAccumulator(100, 50);

		expect(accumulator).toEqual({
			stepMs: 100,
			maxStepsPerFrame: 50,
			carriedMs: 0,
			droppedMs: 0,
		});
	});

	test("rejects a non-positive or non-finite stepMs", () => {
		expect(() => createAccumulator(0, 50)).toThrow(RangeError);
		expect(() => createAccumulator(-100, 50)).toThrow(RangeError);
		expect(() => createAccumulator(Number.NaN, 50)).toThrow(RangeError);
		expect(() => createAccumulator(Number.POSITIVE_INFINITY, 50)).toThrow(
			RangeError,
		);
	});

	test("rejects a non-positive or non-integer maxStepsPerFrame", () => {
		expect(() => createAccumulator(100, 0)).toThrow(RangeError);
		expect(() => createAccumulator(100, -1)).toThrow(RangeError);
		expect(() => createAccumulator(100, 1.5)).toThrow(RangeError);
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

		const steps = clock.frame();

		expect(steps).toBe(0);
		expect(clock.accumulator.carriedMs).toBe(0);
	});

	test("later frames return steps for the time since the previous frame", () => {
		const time = fakeClock(1000);
		const clock = createClock({
			stepMs: 100,
			maxStepsPerFrame: 50,
			now: time.now,
		});
		clock.frame();

		time.tick(250);
		const first = clock.frame();
		time.tick(50);
		const second = clock.frame();

		expect(first).toBe(2);
		expect(second).toBe(1);
	});

	test("a clock that jumps backward yields 0 steps and resumes from the new time", () => {
		const time = fakeClock(10_000);
		const clock = createClock({
			stepMs: 100,
			maxStepsPerFrame: 50,
			now: time.now,
		});
		clock.frame();

		time.tick(-5000);
		const backward = clock.frame();
		time.tick(100);
		const resumed = clock.frame();

		expect(backward).toBe(0);
		expect(resumed).toBe(1);
	});

	test("a one-hour jump is capped and the excess lands in droppedMs", () => {
		const time = fakeClock();
		const clock = createClock({
			stepMs: 100,
			maxStepsPerFrame: DEFAULT_MAX_STEPS_PER_FRAME,
			now: time.now,
		});
		clock.frame();

		time.tick(3_600_000);
		const steps = clock.frame();

		expect(steps).toBe(DEFAULT_MAX_STEPS_PER_FRAME);
		expect(clock.accumulator.droppedMs).toBeCloseTo(3_600_000 - 50 * 100, 6);
		expect(clock.accumulator.carriedMs).toBeLessThan(100);
	});

	test("defaults to performance.now when no time source is given", () => {
		const clock = createClock({ stepMs: 100, maxStepsPerFrame: 50 });

		expect(clock.frame()).toBe(0);
		expect(clock.frame()).toBeGreaterThanOrEqual(0);
	});
});
