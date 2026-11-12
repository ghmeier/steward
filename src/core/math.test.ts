import { describe, expect, test } from "bun:test";
import {
  type AbsorbedAdditionLog,
  type AddContext,
  add,
  clampFinite,
  normalizeZero,
  powInt,
} from "./math";

function contextWith(
  absorbed: AbsorbedAdditionLog | null,
  overrides: Partial<AddContext> = {},
): AddContext {
  return {
    tick: 7,
    maxValue: 1e30,
    capOf: () => Number.POSITIVE_INFINITY,
    absorbed,
    ...overrides,
  };
}

describe("powInt", () => {
  test("computes exact integer powers including zero and negative exponents", () => {
    expect(powInt(2, 10)).toBe(1024);
    expect(powInt(3, 0)).toBe(1);
    expect(powInt(0, 0)).toBe(1);
    expect(powInt(2, -3)).toBe(0.125);
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

  test.each([1.5, Number.NaN])("rejects the exponent %p", (exponent) => {
    expect(() => powInt(2, exponent)).toThrow();
  });
});

describe("normalizeZero", () => {
  test("turns negative zero into positive zero and leaves other values", () => {
    expect(Object.is(normalizeZero(-0), 0)).toBe(true);
    expect(normalizeZero(-5)).toBe(-5);
    expect(normalizeZero(5)).toBe(5);
  });
});

describe("clampFinite", () => {
  test("turns infinities into the bounds and leaves in-range values", () => {
    expect(clampFinite(Number.POSITIVE_INFINITY, 100)).toBe(100);
    expect(clampFinite(Number.NEGATIVE_INFINITY, 100)).toBe(-100);
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
  test("adds to an existing resource and treats a missing one as zero", () => {
    const resources: Record<string, number> = { food: 10 };

    add(resources, "food", 5, contextWith(null));
    add(resources, "wood", 3, contextWith(null));

    expect(resources).toEqual({ food: 15, wood: 3 });
  });

  test("clamps the result at the maximum value", () => {
    const resources = { food: 90 };

    add(resources, "food", 50, contextWith(null, { maxValue: 100 }));

    expect(resources.food).toBe(100);
  });

  test("an addition past the cap is lost, unlogged, and stock above the cap is kept", () => {
    const absorbed: AbsorbedAdditionLog = {};
    const capped = contextWith(absorbed, { capOf: () => 100 });
    const nearFull = { food: 95 };
    const full = { food: 100 };
    const overFull = { food: 130 };

    add(nearFull, "food", 20, capped);
    add(full, "food", 1, capped);
    add(overFull, "food", 20, capped);
    add(overFull, "food", -10, capped);

    expect(nearFull.food).toBe(100);
    expect(full.food).toBe(100);
    expect(overFull.food).toBe(120);
    expect(absorbed).toEqual({});
  });

  test("never stores negative zero", () => {
    const resources = { food: 1 };

    add(resources, "food", -1, contextWith(null));

    expect(Object.is(resources.food, 0)).toBe(true);
  });

  test("records additions absorbed by a much larger value, keeping the first tick", () => {
    const resources = { gold: 1e20 };
    const absorbed: AbsorbedAdditionLog = {};

    add(resources, "gold", 1, contextWith(absorbed, { tick: 12 }));
    add(resources, "gold", 1, contextWith(absorbed, { tick: 13 }));

    expect(resources.gold).toBe(1e20);
    expect(absorbed).toEqual({ gold: { count: 2, firstTick: 12 } });
  });

  test.each([
    ["an addition that changed the value", 10, 1, 1e30],
    ["a value pinned at the maximum", 100, 5, 100],
    ["a zero delta", 1e20, 0, 1e30],
  ])("does not record %s", (_name, start, delta, maxValue) => {
    const resources = { gold: start };
    const absorbed: AbsorbedAdditionLog = {};

    add(resources, "gold", delta, contextWith(absorbed, { maxValue }));

    expect(absorbed).toEqual({});
  });

  test("tolerates a null absorbed log", () => {
    const resources = { gold: 1e20 };

    add(resources, "gold", 1, contextWith(null));

    expect(resources.gold).toBe(1e20);
  });
});
