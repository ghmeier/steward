import { describe, expect, test } from "bun:test";
import {
  type Condition,
  type Decree,
  type DecreeLimits,
  decreeReferences,
  orderDecrees,
  parseCondition,
  parseDecree,
} from "./decree";

const limits: DecreeLimits = {
  maxRules: 2,
  maxConditionNodes: 4,
  maxConditionDepth: 3,
};

const winter: Condition = { kind: "season", season: "winter" };

function chose(decree: string): Condition {
  return { kind: "chose", decree, policy: "sell" };
}

function decree(id: string, when?: Condition): Decree {
  return {
    id,
    petition: "harvest",
    rules: when ? [{ when, policy: "feed" }] : [],
    otherwise: "sell",
  };
}

function records(...decrees: Decree[]): Record<string, Decree> {
  return Object.fromEntries(decrees.map((entry) => [entry.id, entry]));
}

function allOf(count: number): Condition {
  return { kind: "all", conditions: Array(count).fill(winter) };
}

function nested(depth: number): Condition {
  let condition = winter;
  for (let level = 1; level < depth; level++) {
    condition = { kind: "not", condition };
  }
  return condition;
}

function rejection(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  return "";
}

describe("parseDecree", () => {
  test("returns an equal decree that shares nothing with the input, conditions of every kind included", () => {
    const when: Condition = {
      kind: "all",
      conditions: [
        {
          kind: "compare",
          quantity: "grainSeasons",
          comparison: "above",
          value: 2,
        },
        {
          kind: "any",
          conditions: [winter, { kind: "not", condition: chose("b") }],
        },
      ],
    };
    const input = decree("a", when);
    const wide = { ...limits, maxConditionNodes: 6, maxConditionDepth: 4 };

    const parsed = parseDecree(input, wide);
    input.rules.length = 0;

    expect(parsed).toEqual(decree("a", when));
  });

  const rule = { when: winter, policy: "feed" };
  const wide = { ...limits, maxConditionNodes: 9 };
  // biome-ignore format: one row per line keeps the table scannable
  const limitRows: [string, Decree, DecreeLimits, string | null][] = [
		["decree.rules: exactly maxRules is allowed", { ...decree("a"), rules: [rule, rule] }, limits, null],
		["decree.rules: one more than maxRules", { ...decree("a"), rules: [rule, rule, rule] }, limits, "decree.rules:"],
		["decree.rules[0].when: exactly maxConditionNodes is allowed", decree("a", allOf(3)), limits, null],
		["decree.rules[0].when.conditions[3]: one more than maxConditionNodes", decree("a", allOf(4)), limits, "decree.rules[0].when.conditions[3]:"],
		["decree.rules: nodes are counted per rule, not across the decree", { ...decree("a"), rules: [{ ...rule, when: allOf(3) }, { ...rule, when: allOf(3) }] }, limits, null],
		["decree.rules[0].when: exactly maxConditionDepth is allowed", decree("a", nested(3)), wide, null],
		["decree.rules[0].when.condition.condition.condition: one deeper than maxConditionDepth", decree("a", nested(4)), wide, "decree.rules[0].when.condition.condition.condition:"],
	];

  test.each(limitRows)("%s", (_name, input, using, problem) => {
    const message = rejection(() => parseDecree(input, using));

    if (problem === null) expect(message).toBe("");
    else expect(message).toStartWith(problem);
  });
});

describe("parseDecree condition nesting", () => {
  const unbounded = {
    maxRules: 2,
    maxConditionNodes: Number.MAX_SAFE_INTEGER,
    maxConditionDepth: Number.MAX_SAFE_INTEGER,
  };

  test("accepts nesting exactly to the cap and rejects deeper, even 10,000 levels, with a message instead of a stack overflow", () => {
    const atCap = rejection(() =>
      parseDecree(decree("a", nested(64)), unbounded),
    );
    const pastCap = rejection(() =>
      parseDecree(decree("a", nested(65)), unbounded),
    );
    const pathological = rejection(() =>
      parseDecree(decree("a", nested(10_000)), unbounded),
    );

    expect(atCap).toBe("");
    expect(pastCap).toContain("nests deeper than 64 levels");
    expect(pathological).toContain("nests deeper than 64 levels");
    expect(pathological).toStartWith("decree.rules[0].when.condition");
  });
});

describe("parseDecree rejections", () => {
  const compare = (value: number) =>
    decree("a", {
      kind: "compare",
      quantity: "coin",
      comparison: "above",
      value,
    });

  test("rejects non-finite compare values and turns negative zero into zero", () => {
    const parsed = parseDecree(compare(-0), limits);

    for (const value of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      expect(rejection(() => parseDecree(compare(value), limits))).toStartWith(
        "decree.rules[0].when.value:",
      );
    }
    expect(
      Object.is(
        parsed.rules[0]?.when.kind === "compare" && parsed.rules[0].when.value,
        0,
      ),
    ).toBe(true);
  });

  test("rejects an unknown key, naming the object that holds it", () => {
    const message = rejection(() =>
      parseDecree({ ...decree("a"), extra: 1 }, limits),
    );

    expect(message).toStartWith("decree:");
    expect(message).toContain("extra");
  });
});

test("parseCondition rejects an unknown season or an uncapped full resource under the caller's path", () => {
  const unknownSeason = { kind: "season", season: "monsoon" };
  const uncappedFull = { kind: "full", resource: "coin" };

  for (const condition of [unknownSeason, uncappedFull]) {
    expect(
      rejection(() => parseCondition(condition, limits, "x.when")),
    ).toStartWith("x.when");
  }
});

describe("orderDecrees", () => {
  // biome-ignore format: one row per line keeps the table scannable
  const orders: [string, Decree[], string[]][] = [
		["a dependency comes before its dependent", [decree("a", chose("z")), decree("z")], ["z", "a"]],
		["independent decrees are ordered by id, whatever the insertion order", [decree("c"), decree("a"), decree("b")], ["a", "b", "c"]],
		["dependencies outrank id order", [decree("z", chose("m")), decree("m", chose("b")), decree("b"), decree("a")], ["a", "b", "m", "z"]],
		["a reference to an id outside the record is ignored", [decree("a", chose("ghost"))], ["a"]],
	];

  test.each(orders)("%s", (_name, decrees, order) => {
    const forward = orderDecrees(records(...decrees));
    const backward = orderDecrees(records(...[...decrees].reverse()));

    expect(forward).toEqual({ ok: true, order });
    expect(backward).toEqual(forward);
  });

  test("reports a longer cycle with only its members, each referencing the next", () => {
    const all = records(
      decree("aa"),
      decree("a", chose("b")),
      decree("b", { kind: "all", conditions: [chose("aa"), chose("c")] }),
      decree("c", chose("d")),
      decree("d", chose("b")),
    );

    const result = orderDecrees(all);

    if (result.ok) throw new Error("expected a cycle");
    expect([...result.cycle].sort()).toEqual(["b", "c", "d"]);
    result.cycle.forEach((id, index) => {
      const next = result.cycle[(index + 1) % result.cycle.length] as string;
      expect(decreeReferences(all[id] as Decree)).toContain(next);
    });
  });
});
