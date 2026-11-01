import { describe, expect, test } from "bun:test";
import { evaluateCondition, quantityValue } from "../src/core/conditions";
import {
  type Condition,
  decreeSetProblem,
  type Petition,
} from "../src/core/decree";
import {
  enactDecree,
  policiesFor,
  repealDecree,
  repealStaleDecrees,
  runDecrees,
} from "../src/core/decree-engine";
import { laborCounts } from "../src/core/delegates";
import type { AddContext } from "../src/core/math";
import { createNewGame } from "../src/core/state";
import {
  grantUnlocks,
  setRoster,
  economyTestTuning as tuning,
} from "./helpers";

const context: AddContext = { tick: 1, maxValue: 1e300, absorbed: null };
const none = { harvest: 0, wood: 0, ore: 0 };
const surplus = { harvest: 3, wood: 0, ore: 0 };

type Rule = { when: Condition; policy: string };

function above(
  quantity: "grain" | "wood" | "ore" | "grainSeasons",
  value: number,
) {
  return { kind: "compare", quantity, comparison: "above", value } as const;
}

function chose(decree: string, policy: string): Condition {
  return { kind: "chose", decree, policy };
}

function decreeOf(
  id: string,
  petition: Petition,
  rules: Rule[] = [],
  otherwise = "stockpile",
) {
  return { id, petition, rules, otherwise };
}

function freshState() {
  const state = createNewGame(1, tuning);
  grantUnlocks(state, ["decree.compound", "decree.chaining"]);
  return state;
}

function enactOk(state: ReturnType<typeof freshState>, value: unknown) {
  expect(enactDecree(state, value, tuning)).toEqual({ ok: true });
}

/** A harvest decree, a labor decree that chains on it, and a wood decree. */
function governedState() {
  const state = freshState();
  enactOk(state, decreeOf("granary", "harvest"));
  enactOk(
    state,
    decreeOf(
      "workers",
      "labor",
      [{ when: chose("granary", "sell"), policy: "farming" }],
      "balanced",
    ),
  );
  enactOk(state, decreeOf("timber", "wood", [], "sell"));
  return state;
}

test("policiesFor offers each petition its own policies, labor sorted from tuning", () => {
  expect(policiesFor("wood", tuning)).toEqual(["sell", "stockpile"]);
  expect(policiesFor("ore", tuning)).toEqual(["sell", "stockpile"]);
  expect(policiesFor("harvest", tuning)).toEqual(["feed", "sell", "stockpile"]);
  expect(policiesFor("labor", tuning)).toEqual(["balanced", "farming"]);
});

describe("enactDecree", () => {
  test("stores an accepted decree under its id, replacing the same id, without keeping the caller's object", () => {
    const state = freshState();
    const decree = decreeOf("granary", "harvest", [
      { when: above("grainSeasons", 3), policy: "sell" },
    ]);
    enactOk(state, decree);
    decree.otherwise = "sell";
    decree.rules.length = 0;

    expect(state.posting.decrees.granary?.otherwise).toBe("stockpile");
    expect(state.posting.decrees.granary?.rules).toHaveLength(1);

    enactOk(state, decreeOf("granary", "harvest", [], "feed"));

    expect(Object.keys(state.posting.decrees)).toEqual(["granary"]);
    expect(state.posting.decrees.granary?.otherwise).toBe("feed");
  });

  const { maxRules } = tuning.decrees;
  const tooManyRules = Array.from({ length: maxRules + 1 }, () => ({
    when: above("grain", 1),
    policy: "sell",
  }));
  // biome-ignore format: one row per line keeps the table scannable
  const rejections: [string, unknown, RegExp][] = [
		["granary: rule policy from another petition", decreeOf("granary", "harvest", [{ when: above("grain", 1), policy: "farming" }]), /^decree "granary": policy "farming" is not a harvest policy$/],
		["workers: otherwise policy from another petition", decreeOf("workers", "labor", [], "sell"), /^decree "workers": policy "sell" is not a labor policy$/],
		["mine: ore rule cannot feed", decreeOf("mine", "ore", [{ when: above("ore", 1), policy: "feed" }], "sell"), /^decree "mine": policy "feed" is not a/],
		["mine: ore otherwise cannot feed", decreeOf("mine", "ore", [], "feed"), /^decree "mine": policy "feed" is not a/],
		["barn: harvest petition is already handled", decreeOf("barn", "harvest"), /^decree "granary" already handles the harvest petition$/],
		["granary: replacing a referenced decree on another petition", decreeOf("granary", "labor", [], "balanced"), /^decree "workers" already handles the labor petition$/],
		["mine: references unknown decree", decreeOf("mine", "ore", [{ when: chose("ghost", "sell"), policy: "sell" }]), /^decree "mine" references unknown decree "ghost"$/],
		["mine: chose names a policy the target cannot choose", decreeOf("mine", "ore", [{ when: chose("timber", "feed"), policy: "sell" }]), /^decree "mine" tests for policy "feed", which decree "timber" cannot choose$/],
		["granary: cycle through workers", decreeOf("granary", "harvest", [{ when: chose("workers", "balanced"), policy: "stockpile" }]), /^decree cycle: granary -> workers -> granary$/],
		["mine: tests its own choice", decreeOf("mine", "ore", [{ when: chose("mine", "sell"), policy: "sell" }]), /^decree cycle: mine -> mine$/],
		["granary: more rules than the limit", decreeOf("granary", "harvest", tooManyRules), new RegExp(`^decree.rules: has more than ${maxRules} rules$`)],
	];

  test.each(rejections)(
    "rejects %s and leaves the active decrees alone",
    (_name, value, reason) => {
      const state = governedState();
      const before = structuredClone(state.posting.decrees);

      const result = enactDecree(state, value, tuning);

      expect(result.ok).toBe(false);
      expect(result.ok ? "" : result.reason).toMatch(reason);
      expect(state.posting.decrees).toEqual(before);
    },
  );
});

describe("repealDecree", () => {
  test("removes an unreferenced decree", () => {
    const state = governedState();

    expect(repealDecree(state, "workers")).toEqual({ ok: true });

    expect(Object.keys(state.posting.decrees).sort()).toEqual([
      "granary",
      "timber",
    ]);
  });

  test.each([
    ["ghost", 'no active decree "ghost"'],
    ["constructor", 'no active decree "constructor"'],
    ["granary", 'decree "workers" references "granary"'],
  ])("rejects repealing %s and keeps every decree", (id, reason) => {
    const state = governedState();

    const result = repealDecree(state, id);

    expect(result).toEqual({ ok: false, reason });
    expect(Object.keys(state.posting.decrees)).toHaveLength(3);
  });
});

describe("conditions", () => {
  test("quantityValue reads each quantity from the state", () => {
    const state = freshState();
    setRoster(state, { farm: 3, idle: 7 });

    expect(quantityValue("grain", state, tuning)).toBe(60);
    expect(quantityValue("coin", state, tuning)).toBe(0);
    expect(quantityValue("population", state, tuning)).toBe(10);
    expect(quantityValue("idle", state, tuning)).toBe(7);
    // 60 grain over 10 people eating 0.01 for 600 ticks.
    expect(quantityValue("grainSeasons", state, tuning)).toBe(1);
  });

  const grainIs = (
    comparison: "above" | "below",
    value: number,
  ): Condition => ({
    kind: "compare",
    quantity: "grain",
    comparison,
    value,
  });
  const yes = grainIs("above", 0);
  const no = grainIs("below", 0);
  // biome-ignore format: one row per line keeps the table scannable
  const rows: [string, Condition, Record<string, string>, boolean][] = [
		["above is strict at the boundary", grainIs("above", 60), {}, false],
		["above passes just under the boundary", grainIs("above", 59), {}, true],
		["below is strict at the boundary", grainIs("below", 60), {}, false],
		["below passes just over the boundary", grainIs("below", 61), {}, true],
		["season matches the current season", { kind: "season", season: "summer" }, {}, true],
		["season rejects another season", { kind: "season", season: "spring" }, {}, false],
		["chose matches the policy picked this tick", chose("granary", "sell"), { granary: "sell" }, true],
		["chose rejects another policy", chose("granary", "feed"), { granary: "sell" }, false],
		["chose is false for a decree that has not run", chose("constructor", "sell"), {}, false],
		["all needs every child", { kind: "all", conditions: [yes, no] }, {}, false],
		["any needs one child", { kind: "any", conditions: [no, yes] }, {}, true],
		["not inverts", { kind: "not", condition: no }, {}, true],
	];

  test.each(rows)("evaluateCondition: %s", (_name, condition, chosen, want) => {
    const state = freshState();
    state.tick = 601;

    expect(evaluateCondition(condition, state, tuning, chosen)).toBe(want);
  });
});

describe("runDecrees on resources", () => {
  // biome-ignore format: one row per line keeps the table scannable
  const sales: [string, Petition, { stock: number; made: number; rule?: Rule; otherwise: string }, number, number][] = [
		["a wood threshold sells the whole stock above it", "wood", { stock: 80, made: 1, rule: { when: above("wood", 50), policy: "sell" }, otherwise: "stockpile" }, 50, 30],
		["an ore threshold sells the whole stock above it", "ore", { stock: 80, made: 1, rule: { when: above("ore", 50), policy: "sell" }, otherwise: "stockpile" }, 50, 30],
		["sell through otherwise sells only the new production", "wood", { stock: 80, made: 4, otherwise: "sell" }, 76, 4],
		["a threshold on another resource sells only the new production", "wood", { stock: 80, made: 4, rule: { when: above("ore", -1), policy: "sell" }, otherwise: "stockpile" }, 76, 4],
		["a negative threshold sells down to zero, never below", "wood", { stock: 5, made: 0, rule: { when: above("wood", -10), policy: "sell" }, otherwise: "stockpile" }, 0, 5],
		["selling never exceeds the stock", "ore", { stock: 2, made: 5, otherwise: "sell" }, 0, 2],
	];

  test.each(sales)("%s", (_name, petition, setup, wantStock, wantSold) => {
    const state = freshState();
    state.posting.resources[petition] = setup.stock;
    enactOk(
      state,
      decreeOf("d", petition, setup.rule ? [setup.rule] : [], setup.otherwise),
    );

    runDecrees(state, tuning, context, { ...none, [petition]: setup.made });

    const price = petition === "wood" ? "woodPrice" : "orePrice";
    expect(state.posting.resources[petition]).toBe(wantStock);
    expect(state.posting.resources.coin).toBe(wantSold * tuning.economy[price]);
  });
});

describe("runDecrees on the harvest", () => {
  test("sell turns the surplus into coin, feed into growth, stockpile keeps it as grain", () => {
    const outcome = (policy: string) => {
      const state = freshState();
      enactOk(state, decreeOf("granary", "harvest", [], policy));
      runDecrees(state, tuning, context, surplus);
      return {
        grain: state.posting.resources.grain,
        coin: state.posting.resources.coin,
        growth: state.posting.economy.growth,
      };
    };

    expect(outcome("sell")).toEqual({ grain: 57, coin: 1.5, growth: 0 });
    expect(outcome("feed")).toEqual({ grain: 57, coin: 0, growth: 3 });
    expect(outcome("stockpile")).toEqual({ grain: 60, coin: 0, growth: 0 });
  });

  test("feed above a grain threshold feeds the excess into growth", () => {
    const state = freshState();
    state.posting.resources.grain = 75 + 1.5 * tuning.economy.grainPerPeasant;
    enactOk(
      state,
      decreeOf(
        "granary",
        "harvest",
        [{ when: above("grain", 75), policy: "feed" }],
        "stockpile",
      ),
    );
    const population = state.posting.delegates.length;

    runDecrees(state, tuning, context, none);

    expect(state.posting.resources.grain).toBe(75);
    expect(state.posting.delegates.length).toBeGreaterThan(population);
  });

  const early = { when: above("grainSeasons", 0.5), policy: "sell" };
  const late = { when: above("grainSeasons", 0.1), policy: "feed" };
  const never = { when: above("grainSeasons", 5), policy: "sell" };

  test.each([
    ["the first matching rule wins over later ones", [early, late], "sell"],
    ["a later rule applies when the earlier one misses", [never, late], "feed"],
    ["otherwise applies only when no rule matches", [never], "stockpile"],
  ])("%s", (_name, rules, want) => {
    const state = freshState();
    enactOk(state, decreeOf("granary", "harvest", rules, "stockpile"));

    const chosen = runDecrees(state, tuning, context, surplus);

    expect(chosen).toEqual({ granary: want });
  });
});

describe("runDecrees on labor and chaining", () => {
  test("a labor decree moves one peasant per tick toward its allocation", () => {
    const state = freshState();
    enactOk(state, decreeOf("workers", "labor", [], "farming"));

    runDecrees(state, tuning, context, surplus);
    runDecrees(state, tuning, context, surplus);

    expect(laborCounts(state.posting.delegates).farm).toBe(2);
  });

  // With five farmers, farming (7/2/1) adds a farmer and balanced (5/3/2) adds a forester.
  test.each([
    ["sell", "farming", { farm: 6, forest: 0 }],
    ["stockpile", "balanced", { farm: 5, forest: 1 }],
  ])(
    "a later decree reacts to what an earlier one chose this tick: granary %s",
    (granaryPolicy, wantLabor, wantCounts) => {
      const state = freshState();
      setRoster(state, { farm: 5, idle: 5 });
      enactOk(state, decreeOf("granary", "harvest", [], granaryPolicy));
      enactOk(
        state,
        decreeOf(
          "a-workforce",
          "labor",
          [{ when: chose("granary", "sell"), policy: "farming" }],
          "balanced",
        ),
      );

      const chosen = runDecrees(state, tuning, context, surplus);

      expect(chosen["a-workforce"]).toBe(wantLabor);
      expect(laborCounts(state.posting.delegates)).toMatchObject(wantCounts);
    },
  );
});

describe("repealStaleDecrees", () => {
  const staleLabor = decreeOf("workers", "labor", [], "foraging");
  const chained = decreeOf(
    "tithe",
    "wood",
    [{ when: chose("workers", "balanced"), policy: "sell" }],
    "stockpile",
  );
  const chainedTwice = decreeOf(
    "market",
    "ore",
    [{ when: chose("tithe", "sell"), policy: "sell" }],
    "stockpile",
  );
  const granary = decreeOf("granary", "harvest", [], "feed");

  // biome-ignore format: one row per line keeps the table scannable
  const cases: [string, ReturnType<typeof decreeOf>[], string[], string[]][] = [
		["a stale labor decree is removed", [staleLabor, granary], ["workers"], ["granary"]],
		["decrees chaining on a removed decree are removed transitively", [staleLabor, chained, chainedTwice, granary], ["market", "tithe", "workers"], ["granary"]],
		["a decree testing a removed policy of a kept decree is removed", [decreeOf("workers", "labor", [], "balanced"), decreeOf("tithe", "wood", [{ when: chose("workers", "foraging"), policy: "sell" }], "stockpile"), granary], ["tithe"], ["granary", "workers"]],
		["valid decrees are kept", [decreeOf("workers", "labor", [], "balanced"), granary], [], ["granary", "workers"]],
	];

  test.each(cases)("%s", (_name, decrees, removed, kept) => {
    const state = freshState();
    for (const decree of decrees) state.posting.decrees[decree.id] = decree;

    const result = repealStaleDecrees(state, tuning);

    expect(result).toEqual(removed);
    expect(Object.keys(state.posting.decrees).sort()).toEqual(kept);
    expect(
      decreeSetProblem(state.posting.decrees, policiesFor("labor", tuning)),
    ).toBeNull();
  });
});
