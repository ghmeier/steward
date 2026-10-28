import { describe, expect, test } from "bun:test";
import {
	chance,
	intBelow,
	nextU32,
	type RngState,
	seedStream,
} from "../src/core/rng";

// First outputs of xoshiro128** (prng.di.unimi.it reference C implementation,
// rotl(s[1] * 5, 7) * 9) from state [1, 2, 3, 4], produced by compiling that C code.
const REFERENCE_OUTPUTS = [
	11520, 0, 5927040, 70819200, 2031721883, 1637235492, 1287239034, 3734860849,
	3729100597, 4258142804,
];

function drawMany(stream: RngState, count: number): number[] {
	return Array.from({ length: count }, () => nextU32(stream));
}

describe("nextU32", () => {
	test("matches the published xoshiro128** outputs for state [1, 2, 3, 4]", () => {
		const stream: RngState = [1, 2, 3, 4];

		const outputs = drawMany(stream, REFERENCE_OUTPUTS.length);

		expect(outputs).toEqual(REFERENCE_OUTPUTS);
	});

	test("keeps every state word a uint32 after many draws", () => {
		const stream = seedStream(7, "toy");

		drawMany(stream, 1000);

		for (const word of stream) {
			expect(Number.isInteger(word) && word >= 0 && word < 2 ** 32).toBe(true);
		}
	});

	test("continues identically from a structuredClone and a JSON round trip of the state", () => {
		const stream = seedStream(42, "toy");
		drawMany(stream, 500);
		const cloned = structuredClone(stream);
		const parsed = JSON.parse(JSON.stringify(stream)) as RngState;

		const original = drawMany(stream, 500);

		expect(drawMany(cloned, 500)).toEqual(original);
		expect(drawMany(parsed, 500)).toEqual(original);
	});

	test("diverges when the state is not restored", () => {
		const stream = seedStream(42, "toy");
		const fresh = seedStream(42, "toy");
		drawMany(stream, 10);

		expect(drawMany(stream, 5)).not.toEqual(drawMany(fresh, 5));
	});
});

describe("seedStream", () => {
	test("returns identical state for the same seed and name", () => {
		expect(seedStream(123, "toy")).toEqual(seedStream(123, "toy"));
	});

	test("returns different state for different names", () => {
		expect(seedStream(123, "toy")).not.toEqual(seedStream(123, "weather"));
	});

	test("returns different state for different seeds", () => {
		expect(seedStream(123, "toy")).not.toEqual(seedStream(124, "toy"));
	});

	test("never returns the all-zero state", () => {
		for (let seed = 0; seed < 2000; seed++) {
			expect(seedStream(seed, "toy").some((word) => word !== 0)).toBe(true);
		}
		expect(seedStream(0, "").some((word) => word !== 0)).toBe(true);
	});

	test("returns a plain array of four uint32 words", () => {
		const state = seedStream(0xffffffff, "toy");

		expect(Array.isArray(state)).toBe(true);
		expect(state).toHaveLength(4);
		for (const word of state) {
			expect(Number.isInteger(word) && word >= 0 && word < 2 ** 32).toBe(true);
		}
	});

	test("rejects a seed that is not a uint32", () => {
		expect(() => seedStream(-1, "toy")).toThrow();
		expect(() => seedStream(1.5, "toy")).toThrow();
		expect(() => seedStream(2 ** 32, "toy")).toThrow();
	});
});

describe("intBelow", () => {
	test("stays within [0, n) over many draws", () => {
		const stream = seedStream(1, "range");

		for (let i = 0; i < 10000; i++) {
			const value = intBelow(stream, 7);
			expect(value >= 0 && value < 7 && Number.isInteger(value)).toBe(true);
		}
	});

	test("reaches every value in a small range", () => {
		const stream = seedStream(1, "range");
		const seen = new Set<number>();

		for (let i = 0; i < 1000; i++) {
			seen.add(intBelow(stream, 5));
		}

		expect([...seen].sort()).toEqual([0, 1, 2, 3, 4]);
	});

	test("returns 0 when n is 1", () => {
		expect(intBelow(seedStream(1, "range"), 1)).toBe(0);
	});

	test("accepts n of 2^32 and returns a raw draw", () => {
		const stream = seedStream(1, "range");
		const expected = nextU32(seedStream(1, "range"));

		expect(intBelow(stream, 2 ** 32)).toBe(expected);
	});

	test("rejects n that is not a positive integer up to 2^32", () => {
		const stream = seedStream(1, "range");

		for (const bad of [
			0,
			-1,
			1.5,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			2 ** 32 + 1,
		]) {
			expect(() => intBelow(stream, bad)).toThrow();
		}
	});

	test("does not advance the stream when n is rejected", () => {
		const stream = seedStream(1, "range");
		const before = structuredClone(stream);

		expect(() => intBelow(stream, 0)).toThrow();

		expect(stream).toEqual(before);
	});
});

describe("chance", () => {
	test("is never true at 0 per mille", () => {
		const stream = seedStream(2, "chance");

		for (let i = 0; i < 2000; i++) {
			expect(chance(stream, 0)).toBe(false);
		}
	});

	test("is always true at 1000 per mille", () => {
		const stream = seedStream(2, "chance");

		for (let i = 0; i < 2000; i++) {
			expect(chance(stream, 1000)).toBe(true);
		}
	});

	test("is true roughly half the time at 500 per mille", () => {
		const stream = seedStream(2, "chance");
		let hits = 0;

		for (let i = 0; i < 10000; i++) {
			if (chance(stream, 500)) hits++;
		}

		expect(hits).toBeGreaterThan(4500);
		expect(hits).toBeLessThan(5500);
	});

	test("rejects non-integer and out-of-range probabilities", () => {
		const stream = seedStream(2, "chance");

		for (const bad of [-1, 1001, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(() => chance(stream, bad)).toThrow();
		}
	});
});
