import { describe, expect, test } from "bun:test";
import { chance, intBelow, nextU32, type RngState, seedStream } from "./rng";

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

  test("continues identically from a saved copy of the state", () => {
    const stream = seedStream(42, "toy");
    drawMany(stream, 500);
    const saved = JSON.parse(JSON.stringify(stream)) as RngState;

    const original = drawMany(stream, 500);

    expect(drawMany(saved, 500)).toEqual(original);
  });
});

describe("seedStream", () => {
  test("is deterministic and differs by seed and by name", () => {
    expect(seedStream(123, "toy")).toEqual(seedStream(123, "toy"));
    expect(seedStream(123, "toy")).not.toEqual(seedStream(123, "weather"));
    expect(seedStream(123, "toy")).not.toEqual(seedStream(124, "toy"));
  });

  test("never returns the all-zero state", () => {
    for (let seed = 0; seed < 2000; seed++) {
      expect(seedStream(seed, "toy").some((word) => word !== 0)).toBe(true);
    }
  });

  test.each([-1, 1.5, 2 ** 32])("rejects the seed %p", (seed) => {
    expect(() => seedStream(seed, "toy")).toThrow();
  });
});

describe("intBelow", () => {
  test("stays within [0, n) and reaches every value", () => {
    const stream = seedStream(1, "range");
    const seen = new Set<number>();

    for (let i = 0; i < 1000; i++) {
      seen.add(intBelow(stream, 5));
    }

    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  test("returns 0 for n of 1 and a raw draw for n of 2^32", () => {
    const expected = nextU32(seedStream(1, "range"));

    expect(intBelow(seedStream(1, "range"), 1)).toBe(0);
    expect(intBelow(seedStream(1, "range"), 2 ** 32)).toBe(expected);
  });

  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 32 + 1])(
    "rejects n of %p",
    (n) => {
      const stream = seedStream(1, "range");
      const before: RngState = [...stream];

      expect(() => intBelow(stream, n)).toThrow();

      expect(stream).toEqual(before);
    },
  );
});

describe("chance", () => {
  test("is never true at 0 per mille and always true at 1000", () => {
    const stream = seedStream(2, "chance");

    for (let i = 0; i < 2000; i++) {
      expect(chance(stream, 0)).toBe(false);
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

  test.each([-1, 1001, 0.5, Number.NaN])("rejects %p per mille", (bad) => {
    expect(() => chance(seedStream(2, "chance"), bad)).toThrow();
  });
});
