import { describe, expect, test } from "bun:test";
import {
	type AbsorbedAdditionLog,
	type AddContext,
	add,
	clampFinite,
	normalizeZero,
	powInt,
} from "../src/core/math";

function contextWith(
	absorbed: AbsorbedAdditionLog | null,
	overrides: Partial<AddContext> = {},
): AddContext {
	return { tick: 7, maxValue: 1e30, absorbed, ...overrides };
}

describe("powInt", () => {
	test("computes exact integer powers", () => {
		expect(powInt(2, 10)).toBe(1024);
		expect(powInt(3, 0)).toBe(1);
	});

	test("matches a hand-multiplied loop bit for bit when every product is exact", () => {
		for (let n = 0; n <= 30; n++) {
			let expected = 1;
			for (let i = 0; i < n; i++) expected *= 1.5;

			expect(Object.is(powInt(1.5, n), expected)).toBe(true);
		}
	});

	test("stays within a few units in the last place of a hand-multiplied loop for 1.15", () => {
		for (let n = 0; n <= 50; n++) {
			let expected = 1;
			for (let i = 0; i < n; i++) expected *= 1.15;

			expect(Math.abs(powInt(1.15, n) / expected - 1)).toBeLessThan(1e-14);
		}
	});

	test("returns 1 for zero to the zero", () => {
		expect(powInt(0, 0)).toBe(1);
	});

	test("returns the reciprocal for a negative exponent", () => {
		expect(powInt(2, -3)).toBe(0.125);
	});

	test("rejects a non-integer exponent", () => {
		expect(() => powInt(2, 1.5)).toThrow();
		expect(() => powInt(2, Number.NaN)).toThrow();
	});
});

describe("normalizeZero", () => {
	test("turns negative zero into positive zero", () => {
		expect(Object.is(normalizeZero(-0), 0)).toBe(true);
	});

	test("leaves other values unchanged", () => {
		expect(normalizeZero(5)).toBe(5);
		expect(normalizeZero(-5)).toBe(-5);
		expect(Object.is(normalizeZero(0), 0)).toBe(true);
	});
});

describe("clampFinite", () => {
	test("turns positive and negative infinity into the bounds", () => {
		expect(clampFinite(Number.POSITIVE_INFINITY, 100)).toBe(100);
		expect(clampFinite(Number.NEGATIVE_INFINITY, 100)).toBe(-100);
	});

	test("leaves in-range values unchanged", () => {
		expect(clampFinite(42, 100)).toBe(42);
	});

	test("throws on NaN", () => {
		expect(() => clampFinite(Number.NaN, 100)).toThrow();
	});

	test("normalizes negative zero to positive zero", () => {
		expect(Object.is(clampFinite(-0, 100), 0)).toBe(true);
	});
});

describe("add", () => {
	test("adds the delta to an existing resource", () => {
		const resources = { food: 10 };

		add(resources, "food", 5, contextWith(null));

		expect(resources.food).toBe(15);
	});

	test("treats a missing resource as zero", () => {
		const resources: Record<string, number> = {};

		add(resources, "wood", 3, contextWith(null));

		expect(resources.wood).toBe(3);
	});

	test("clamps the result at the maximum value", () => {
		const resources = { food: 90 };

		add(resources, "food", 50, contextWith(null, { maxValue: 100 }));

		expect(resources.food).toBe(100);
	});

	test("never stores negative zero", () => {
		const resources = { food: 1 };

		add(resources, "food", -1, contextWith(null));

		expect(Object.is(resources.food, 0)).toBe(true);
	});

	test("records an addition that was absorbed by a much larger value", () => {
		const resources = { gold: 1e20 };
		const absorbed: AbsorbedAdditionLog = {};

		add(resources, "gold", 1, contextWith(absorbed, { tick: 12 }));
		add(resources, "gold", 1, contextWith(absorbed, { tick: 13 }));

		expect(resources.gold).toBe(1e20);
		expect(absorbed).toEqual({ gold: { count: 2, firstTick: 12 } });
	});

	test("does not record an addition that changed the value", () => {
		const resources = { gold: 10 };
		const absorbed: AbsorbedAdditionLog = {};

		add(resources, "gold", 1, contextWith(absorbed));

		expect(absorbed).toEqual({});
	});

	test("does not record when the value is pinned at the maximum", () => {
		const resources = { gold: 100 };
		const absorbed: AbsorbedAdditionLog = {};

		add(resources, "gold", 5, contextWith(absorbed, { maxValue: 100 }));

		expect(absorbed).toEqual({});
	});

	test("does not fail or record when the absorbed log is null", () => {
		const resources = { gold: 1e20 };

		add(resources, "gold", 1, contextWith(null));

		expect(resources.gold).toBe(1e20);
	});

	test("does not record a zero delta", () => {
		const resources = { gold: 1e20 };
		const absorbed: AbsorbedAdditionLog = {};

		add(resources, "gold", 0, contextWith(absorbed));

		expect(absorbed).toEqual({});
	});
});
