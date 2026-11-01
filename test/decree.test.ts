import { describe, expect, test } from "bun:test";
import {
  type Condition,
  type Decree,
  type DecreeLimits,
  decreeReferences,
  orderDecrees,
  parseCondition,
  parseDecree,
} from "../src/core/decree";

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

test("parseCondition reports problems under the caller's path", () => {
  const message = rejection(() =>
    parseCondition({ kind: "season", season: "monsoon" }, limits, "x.when"),
  );

  expect(message).toStartWith("x.when");
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
