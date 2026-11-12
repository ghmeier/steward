import { describe, expect, test } from "bun:test";
import {
  uncappedContext as context,
  contextFor,
  grantUnlocks,
  setRoster,
  economyTestTuning as tuning,
} from "../../test/helpers";
import { type Condition, decreeSetProblem, type Petition } from "./decree";
import { Game } from "./game";

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

function freshGame() {
  const game = Game.create(1, tuning);
  grantUnlocks(game, ["decree.compound", "decree.chaining"]);
  return game;
}

function enactOk(game: Game, value: unknown) {
  expect(() => game.decrees.enact(value)).not.toThrow();
}

/** A harvest decree, a labor decree that chains on it, and a wood decree. */
function governedGame() {
  const game = freshGame();
  enactOk(game, decreeOf("granary", "harvest"));
  enactOk(
    game,
    decreeOf(
      "workers",
      "labor",
      [{ when: chose("granary", "sell"), policy: "farming" }],
      "balanced",
    ),
  );
  enactOk(game, decreeOf("timber", "wood", [], "sell"));
  return game;
}

test("policiesFor offers each petition its own policies, labor sorted from tuning", () => {
  const { decrees } = freshGame();

  expect(decrees.policiesFor("wood")).toEqual(["sell", "stockpile"]);
  expect(decrees.policiesFor("ore")).toEqual(["sell", "stockpile"]);
  expect(decrees.policiesFor("harvest")).toEqual(["feed", "sell", "stockpile"]);
  expect(decrees.policiesFor("labor")).toEqual(["balanced", "farming"]);
});

describe("enact", () => {
  test("stores an accepted decree under its id, replacing the same id, without keeping the caller's object", () => {
    const { decrees } = freshGame();
    const decree = decreeOf("granary", "harvest", [
      { when: above("grainSeasons", 3), policy: "sell" },
    ]);
    decrees.enact(decree);
    decree.otherwise = "sell";
    decree.rules.length = 0;

    expect(decrees.enacted.granary?.otherwise).toBe("stockpile");
    expect(decrees.enacted.granary?.rules).toHaveLength(1);

    decrees.enact(decreeOf("granary", "harvest", [], "feed"));

    expect(Object.keys(decrees.enacted)).toEqual(["granary"]);
    expect(decrees.enacted.granary?.otherwise).toBe("feed");
  });

  const { maxRules } = tuning.decrees;
  const tooManyRules = Array.from({ length: maxRules + 1 }, () => ({
    when: above("grain", 1),
    policy: "sell",
  }));
  // biome-ignore format: one row per line keeps the table scannable
  const rejections: [string, unknown, RegExp][] = [
    [
      "granary: rule policy from another petition",
      decreeOf("granary", "harvest", [
        { when: above("grain", 1), policy: "farming" },
      ]),
      /^decree "granary": policy "farming" is not a harvest policy$/,
    ],
    [
      "workers: otherwise policy from another petition",
      decreeOf("workers", "labor", [], "sell"),
      /^decree "workers": policy "sell" is not a labor policy$/,
    ],
    [
      "mine: ore rule cannot feed",
      decreeOf(
        "mine",
        "ore",
        [{ when: above("ore", 1), policy: "feed" }],
        "sell",
      ),
      /^decree "mine": policy "feed" is not a/,
    ],
    [
      "mine: ore otherwise cannot feed",
      decreeOf("mine", "ore", [], "feed"),
      /^decree "mine": policy "feed" is not a/,
    ],
    [
      "barn: harvest petition is already handled",
      decreeOf("barn", "harvest"),
      /^decree "granary" already handles the harvest petition$/,
    ],
    [
      "granary: replacing a referenced decree on another petition",
      decreeOf("granary", "labor", [], "balanced"),
      /^decree "workers" already handles the labor petition$/,
    ],
    [
      "mine: references unknown decree",
      decreeOf("mine", "ore", [
        { when: chose("ghost", "sell"), policy: "sell" },
      ]),
      /^decree "mine" references unknown decree "ghost"$/,
    ],
    [
      "mine: chose names a policy the target cannot choose",
      decreeOf("mine", "ore", [
        { when: chose("timber", "feed"), policy: "sell" },
      ]),
      /^decree "mine" tests for policy "feed", which decree "timber" cannot choose$/,
    ],
    [
      "granary: cycle through workers",
      decreeOf("granary", "harvest", [
        { when: chose("workers", "balanced"), policy: "stockpile" },
      ]),
      /^decree cycle: granary -> workers -> granary$/,
    ],
    [
      "mine: tests its own choice",
      decreeOf("mine", "ore", [
        { when: chose("mine", "sell"), policy: "sell" },
      ]),
      /^decree cycle: mine -> mine$/,
    ],
    [
      "granary: more rules than the limit",
      decreeOf("granary", "harvest", tooManyRules),
      new RegExp(`^decree.rules: has more than ${maxRules} rules$`),
    ],
  ];

  test.each(rejections)(
    "rejects %s and leaves the active decrees alone",
    (_name, value, reason) => {
      const { decrees } = governedGame();
      const before = structuredClone(decrees.enacted);

      expect(() => decrees.enact(value)).toThrow(reason);
      expect(decrees.enacted).toEqual(before);
    },
  );
});

describe("repeal", () => {
  test("removes an unreferenced decree", () => {
    const { decrees } = governedGame();

    decrees.repeal("workers");

    expect(Object.keys(decrees.enacted).sort()).toEqual(["granary", "timber"]);
  });

  test.each([
    ["ghost", 'no active decree "ghost"'],
    ["constructor", 'no active decree "constructor"'],
    ["granary", 'decree "workers" references "granary"'],
  ])("rejects repealing %s and keeps every decree", (id, reason) => {
    const { decrees } = governedGame();

    expect(() => decrees.repeal(id)).toThrow(reason);
    expect(Object.keys(decrees.enacted)).toHaveLength(3);
  });
});

describe("conditions", () => {
  test("quantityOf reads each quantity from the game", () => {
    const game = freshGame();
    setRoster(game, { farm: 3, idle: 7 });
    const { conditions } = game;

    expect(conditions.quantityOf("grain")).toBe(60);
    expect(conditions.quantityOf("coin")).toBe(0);
    expect(conditions.quantityOf("population")).toBe(10);
    expect(conditions.quantityOf("idle")).toBe(7);
    // 60 grain over 10 people eating 0.01 for 600 ticks.
    expect(conditions.quantityOf("grainSeasons")).toBe(1);
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
    [
      "season matches the current season",
      { kind: "season", season: "summer" },
      {},
      true,
    ],
    [
      "season rejects another season",
      { kind: "season", season: "spring" },
      {},
      false,
    ],
    [
      "chose matches the policy picked this tick",
      chose("granary", "sell"),
      { granary: "sell" },
      true,
    ],
    [
      "chose rejects another policy",
      chose("granary", "feed"),
      { granary: "sell" },
      false,
    ],
    [
      "chose is false for a decree that has not run",
      chose("constructor", "sell"),
      {},
      false,
    ],
    [
      "all needs every child",
      { kind: "all", conditions: [yes, no] },
      {},
      false,
    ],
    ["any needs one child", { kind: "any", conditions: [no, yes] }, {}, true],
    ["not inverts", { kind: "not", condition: no }, {}, true],
  ];

  test.each(rows)("evaluate: %s", (_name, condition, chosen, want) => {
    const game = freshGame();
    game.state.tick = 601;

    expect(game.conditions.evaluate(condition, chosen)).toBe(want);
  });
});

describe("run on resources", () => {
  // biome-ignore format: one row per line keeps the table scannable
  const sales: [
    string,
    Petition,
    { stock: number; made: number; rule?: Rule; otherwise: string },
    number,
    number,
  ][] = [
    [
      "a wood threshold sells the whole stock above it",
      "wood",
      {
        stock: 80,
        made: 1,
        rule: { when: above("wood", 50), policy: "sell" },
        otherwise: "stockpile",
      },
      50,
      30,
    ],
    [
      "an ore threshold sells the whole stock above it",
      "ore",
      {
        stock: 80,
        made: 1,
        rule: { when: above("ore", 50), policy: "sell" },
        otherwise: "stockpile",
      },
      50,
      30,
    ],
    [
      "sell through otherwise sells only the new production",
      "wood",
      { stock: 80, made: 4, otherwise: "sell" },
      76,
      4,
    ],
    [
      "a threshold on another resource sells only the new production",
      "wood",
      {
        stock: 80,
        made: 4,
        rule: { when: above("ore", -1), policy: "sell" },
        otherwise: "stockpile",
      },
      76,
      4,
    ],
    [
      "a negative threshold sells down to zero, never below",
      "wood",
      {
        stock: 5,
        made: 0,
        rule: { when: above("wood", -10), policy: "sell" },
        otherwise: "stockpile",
      },
      0,
      5,
    ],
    [
      "selling never exceeds the stock",
      "ore",
      { stock: 2, made: 5, otherwise: "sell" },
      0,
      2,
    ],
  ];

  test.each(sales)("%s", (_name, petition, setup, wantStock, wantSold) => {
    const game = freshGame();
    game.state.posting.resources[petition] = setup.stock;
    enactOk(
      game,
      decreeOf("d", petition, setup.rule ? [setup.rule] : [], setup.otherwise),
    );

    game.decrees.run(context, { ...none, [petition]: setup.made });

    const price = petition === "wood" ? "woodPrice" : "orePrice";
    expect(game.state.posting.resources[petition]).toBe(wantStock);
    expect(game.state.posting.resources.coin).toBe(
      wantSold * tuning.economy[price],
    );
  });
});

describe("run on the harvest", () => {
  test("sell turns the surplus into coin, feed into growth, stockpile keeps it as grain", () => {
    const outcome = (policy: string) => {
      const game = freshGame();
      enactOk(game, decreeOf("granary", "harvest", [], policy));
      game.decrees.run(context, surplus);
      return {
        grain: game.state.posting.resources.grain,
        coin: game.state.posting.resources.coin,
        growth: game.state.posting.economy.growth,
      };
    };

    expect(outcome("sell")).toEqual({ grain: 57, coin: 1.5, growth: 0 });
    expect(outcome("feed")).toEqual({ grain: 57, coin: 0, growth: 3 });
    expect(outcome("stockpile")).toEqual({ grain: 60, coin: 0, growth: 0 });
  });

  test("feed above a grain threshold feeds the excess into growth", () => {
    const game = freshGame();
    game.state.posting.resources.grain =
      75 + 1.5 * tuning.economy.grainPerPeasant;
    enactOk(
      game,
      decreeOf(
        "granary",
        "harvest",
        [{ when: above("grain", 75), policy: "feed" }],
        "stockpile",
      ),
    );
    const population = game.state.posting.delegates.length;

    game.decrees.run(context, none);

    expect(game.state.posting.resources.grain).toBe(75);
    expect(game.state.posting.delegates.length).toBeGreaterThan(population);
  });

  const early = { when: above("grainSeasons", 0.5), policy: "sell" };
  const late = { when: above("grainSeasons", 0.1), policy: "feed" };
  const never = { when: above("grainSeasons", 5), policy: "sell" };

  test.each([
    ["the first matching rule wins over later ones", [early, late], "sell"],
    ["a later rule applies when the earlier one misses", [never, late], "feed"],
    ["otherwise applies only when no rule matches", [never], "stockpile"],
  ])("%s", (_name, rules, want) => {
    const game = freshGame();
    enactOk(game, decreeOf("granary", "harvest", rules, "stockpile"));

    const chosen = game.decrees.run(context, surplus);

    expect(chosen).toEqual({ granary: want });
  });
});

describe("run on labor and chaining", () => {
  test("a labor decree moves one peasant per tick toward its allocation", () => {
    const game = freshGame();
    enactOk(game, decreeOf("workers", "labor", [], "farming"));

    game.decrees.run(context, surplus);
    game.decrees.run(context, surplus);

    expect(game.delegates.jobCounts().farm).toBe(2);
  });

  // With five farmers, farming (7/2/1) adds a farmer and balanced (5/3/2) adds a forester.
  test.each([
    ["sell", "farming", { farm: 6, forest: 0 }],
    ["stockpile", "balanced", { farm: 5, forest: 1 }],
  ])(
    "a later decree reacts to what an earlier one chose this tick: granary %s",
    (granaryPolicy, wantLabor, wantCounts) => {
      const game = freshGame();
      setRoster(game, { farm: 5, idle: 5 });
      enactOk(game, decreeOf("granary", "harvest", [], granaryPolicy));
      enactOk(
        game,
        decreeOf(
          "a-workforce",
          "labor",
          [{ when: chose("granary", "sell"), policy: "farming" }],
          "balanced",
        ),
      );

      const chosen = game.decrees.run(context, surplus);

      expect(chosen["a-workforce"]).toBe(wantLabor);
      expect(game.delegates.jobCounts()).toMatchObject(wantCounts);
    },
  );
});

describe("repealStale", () => {
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
    [
      "a stale labor decree is removed",
      [staleLabor, granary],
      ["workers"],
      ["granary"],
    ],
    [
      "decrees chaining on a removed decree are removed transitively",
      [staleLabor, chained, chainedTwice, granary],
      ["market", "tithe", "workers"],
      ["granary"],
    ],
    [
      "a decree testing a removed policy of a kept decree is removed",
      [
        decreeOf("workers", "labor", [], "balanced"),
        decreeOf(
          "tithe",
          "wood",
          [{ when: chose("workers", "foraging"), policy: "sell" }],
          "stockpile",
        ),
        granary,
      ],
      ["tithe"],
      ["granary", "workers"],
    ],
    [
      "valid decrees are kept",
      [decreeOf("workers", "labor", [], "balanced"), granary],
      [],
      ["granary", "workers"],
    ],
  ];

  test.each(cases)("%s", (_name, decrees, removed, kept) => {
    const game = freshGame();
    for (const decree of decrees) game.decrees.enacted[decree.id] = decree;

    const result = game.decrees.repealStale();

    expect(result).toEqual(removed);
    expect(Object.keys(game.decrees.enacted).sort()).toEqual(kept);
    expect(
      decreeSetProblem(game.decrees.enacted, game.decrees.policiesFor("labor")),
    ).toBeNull();
  });
});

describe("the full condition", () => {
  const woodIsFull: Condition = { kind: "full", resource: "wood" };

  function woodStockedAt(stock: (game: Game) => number) {
    const game = freshGame();
    game.state.posting.resources.wood = stock(game);
    return game;
  }

  test("is true when the stock is at the cap", () => {
    const game = woodStockedAt((g) => g.economy.capOf("wood"));

    expect(game.conditions.evaluate(woodIsFull, {})).toBe(true);
  });

  test("is false when the stock is below the cap", () => {
    const game = woodStockedAt((g) => g.economy.capOf("wood") - 1);

    expect(game.conditions.evaluate(woodIsFull, {})).toBe(false);
  });

  test("follows the cap when an upgrade raises it", () => {
    const game = woodStockedAt((g) => g.economy.capOf("wood"));

    grantUnlocks(game, ["store.woodshed1"]);

    expect(game.conditions.evaluate(woodIsFull, {})).toBe(false);
  });

  test("a sell-when-full decree sells each tick's production and keeps the store from losing any", () => {
    const game = woodStockedAt((g) => g.economy.capOf("wood"));
    const cap = game.economy.capOf("wood");
    setRoster(game, { forest: 2 });
    enactOk(
      game,
      decreeOf("timber", "wood", [{ when: woodIsFull, policy: "sell" }]),
    );
    const tick = () => {
      const { flows } = game.economy.run(contextFor(game));
      game.decrees.run(contextFor(game), flows);
      return flows.wood;
    };

    const first = tick();
    const woodAfterFirst = game.state.posting.resources.wood;
    const second = tick();

    expect(woodAfterFirst).toBe(cap - first);
    expect(game.state.posting.resources.wood).toBe(woodAfterFirst);
    expect(game.state.posting.resources.coin).toBe(
      (first + second) * game.economy.priceOf("wood"),
    );
  });

  test("a sell-when-full decree leaves a store below its cap alone", () => {
    const game = woodStockedAt((g) => g.economy.capOf("wood") / 2);
    setRoster(game, { forest: 2 });
    enactOk(
      game,
      decreeOf("timber", "wood", [{ when: woodIsFull, policy: "sell" }]),
    );
    const before = game.state.posting.resources.wood ?? 0;

    const { flows } = game.economy.run(contextFor(game));
    game.decrees.run(contextFor(game), flows);

    expect(game.state.posting.resources.wood).toBe(before + flows.wood);
    expect(game.state.posting.resources.coin).toBe(0);
  });

  test("needs no Archive entry beyond the decrees panel", () => {
    const game = Game.create(1, tuning);

    expect(() =>
      game.decrees.enact(
        decreeOf("timber", "wood", [{ when: woodIsFull, policy: "sell" }]),
      ),
    ).not.toThrow();
  });
});
