import { describe, expect, test } from "bun:test";
import { tuning } from "../../test/helpers";
import { stateHash } from "../save/hash";
import { Game } from "./game";
import { canonicalStringify } from "./serialize";

describe("canonicalStringify", () => {
  test("produces identical bytes regardless of key insertion order", () => {
    const forward = { a: 1, b: { x: 1, y: 2 }, c: [1, 2] };
    const reversed = { c: [1, 2], b: { y: 2, x: 1 }, a: 1 };

    expect(canonicalStringify(reversed)).toBe(canonicalStringify(forward));
  });

  test("orders keys by UTF-16 code unit rather than locale", () => {
    const text = canonicalStringify({ b: 1, B: 2, a: 3, é: 4, z: 5 });

    const keys = [...text.matchAll(/"(.)":/g)].map((m) => m[1]);

    expect(keys).toEqual(["B", "a", "b", "z", "é"]);
  });

  test("indents with two spaces, keeps array order, and ends with a newline", () => {
    const text = canonicalStringify({ list: [3, 1], name: "x" });

    expect(text).toBe(
      '{\n  "list": [\n    3,\n    1\n  ],\n  "name": "x"\n}\n',
    );
  });

  test("restringifying a parsed fresh game gives identical bytes", () => {
    const text = canonicalStringify(Game.create(11, tuning).state);

    expect(canonicalStringify(JSON.parse(text))).toBe(text);
  });

  test.each([
    ["negative zero", -0],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["undefined", undefined],
    ["a Map", new Map()],
    ["a function", () => 1],
    ["null", null],
  ])("throws on %s", (_name, bad) => {
    expect(() => canonicalStringify({ nested: [bad] })).toThrow();
  });

  test("accepts positive zero", () => {
    expect(canonicalStringify({ zero: 0 })).toContain('"zero": 0');
  });
});

describe("stateHash", () => {
  test("is equal for equal states built in different key orders", () => {
    const { state } = Game.create(3, tuning);
    const reordered = {
      posting: {
        economy: state.posting.economy,
        delegates: state.posting.delegates,
        nextDelegateId: state.posting.nextDelegateId,
        decrees: state.posting.decrees,
        resources: state.posting.resources,
        desk: state.posting.desk,
        rng: state.posting.rng,
        seed: state.posting.seed,
        postingId: state.posting.postingId,
      },
      career: state.career,
      tick: state.tick,
      schemaVersion: state.schemaVersion,
    };

    expect(stateHash(reordered)).toBe(stateHash(state));
  });

  test("is a stable 64-character hex string that changes with any change to the state", () => {
    const { state } = Game.create(3, tuning);
    const before = stateHash(state);

    const ticked = { ...state, tick: state.tick + 1 };
    const reseeded = Game.create(4, tuning).state;

    expect(before).toMatch(/^[0-9a-f]{64}$/);
    expect(stateHash(state)).toBe(before);
    expect(stateHash(ticked)).not.toBe(before);
    expect(stateHash(reseeded)).not.toBe(before);
  });
});
