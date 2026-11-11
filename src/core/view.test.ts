import { describe, expect, test } from "bun:test";
import {
  quietOptions,
  setRoster,
  economyTestTuning as tuning,
} from "../../test/helpers";
import type { Decree } from "./decree";
import { Game } from "./game";

const oddStepTuning = { ...tuning, stepMs: 250 };

function village(using = tuning) {
  const game = Game.create(1, using);
  setRoster(game, { farm: 4, forest: 2, mine: 1, idle: 5 });
  return game;
}

function feedDecree(): Decree {
  return { id: "harvest", petition: "harvest", rules: [], otherwise: "feed" };
}

describe("view.compute", () => {
  test("lists every resource sorted by id with the state's amounts and per-second rates", () => {
    const game = village(oddStepTuning);
    game.state.tick = 1;
    game.state.posting.resources.wood = 7;

    const view = game.view.compute();

    // Per tick in spring: grain 4 * 0.025 - 12 * 0.01, wood 2 * 0.02, ore 1 * 0.01; 4 ticks per second.
    const byResource = Object.fromEntries(
      view.ledger.map((line) => [line.resource, line]),
    );
    expect(view.ledger.map((line) => line.resource)).toEqual([
      "coin",
      "grain",
      "ore",
      "wood",
    ]);
    expect(byResource.wood?.amount).toBe(7);
    expect(byResource.grain?.ratePerSecond).toBeCloseTo((0.1 - 0.12) * 4, 12);
    expect(byResource.wood?.ratePerSecond).toBeCloseTo(0.04 * 4, 12);
    expect(byResource.ore?.ratePerSecond).toBeCloseTo(0.01 * 4, 12);
    expect(byResource.coin?.ratePerSecond).toBe(0);
  });

  test("the grain line reports what the peasants eat, matching the net rate when nothing is harvested", () => {
    const game = village(oddStepTuning);
    setRoster(game, { forest: 2, idle: 10 });
    game.state.tick = 1;

    const grain = game.view
      .compute()
      .ledger.find((l) => l.resource === "grain");

    expect(grain?.eatenPerSecond).toBeCloseTo(12 * 0.01 * 4, 12);
    expect(grain?.eatenPerSecond).toBeCloseTo(-(grain?.ratePerSecond ?? 0), 12);
  });

  test("the grain line reports nothing eaten for an empty village, and no other resource reports any", () => {
    const game = village(oddStepTuning);
    setRoster(game, {});

    const { ledger } = game.view.compute();

    expect(ledger.every((line) => line.eatenPerSecond === 0)).toBe(true);
  });

  test("reports the realm's counts, season, elapsed time, locked panels and promotion", () => {
    const game = village(oddStepTuning);
    game.state.tick = tuning.economy.ticksPerSeason + 1;
    game.state.posting.economy.starved = 7;
    game.state.career.promotedAt = 7;
    const grudged = game.delegates.all[0];
    if (grudged) grudged.grudgeUntil = game.state.tick + 50;

    const view = game.view.compute();

    expect(view.realm).toEqual({
      population: 12,
      labor: { farm: 4, forest: 2, mine: 1, idle: 5 },
      season: "summer",
      starved: 7,
    });
    expect(view.elapsedSeconds).toBe((game.state.tick * 250) / 1000);
    expect(view.lockedPanels).toEqual(["archive", "crown"]);
    expect(view.promotion).toEqual({
      target: tuning.village.promotionPopulation,
      promotedAt: 7,
      promotedAtSeconds: (7 * oddStepTuning.stepMs) / 1000,
    });
  });

  test("lists delegates in id order with grudge ticks left, and decrees sorted by id as copies", () => {
    const game = village();
    game.state.tick = 10;
    const [first, second] = game.delegates.all;
    if (first) first.grudgeUntil = 25;
    if (second) second.grudgeUntil = 4;
    for (const id of ["b", "a"]) {
      game.state.posting.decrees[id] = {
        id,
        petition: "harvest",
        rules: [],
        otherwise: "sell",
      };
    }

    const view = game.view.compute();
    view.decrees[0]?.rules.push({
      when: { kind: "season", season: "spring" },
      policy: "feed",
    });

    expect(view.delegates.map((delegate) => delegate.id)).toEqual(
      game.delegates.all.map((delegate) => delegate.id),
    );
    expect(view.delegates.slice(0, 2).map((d) => d.grudgeTicks)).toEqual([
      15, 0,
    ]);
    expect(view.decrees.map((decree) => decree.id)).toEqual(["a", "b"]);
    expect(game.state.posting.decrees.a?.rules).toEqual([]);
  });

  test("an earlier view stays unchanged when the state steps afterwards, and survives a JSON round trip", () => {
    const game = village();
    game.state.posting.decrees.harvest = feedDecree();
    const view = game.view.compute();
    const copy = structuredClone(view);

    game.steps.runSteps(10, [], quietOptions);

    expect(view).toEqual(copy);
    expect(game.view.compute()).not.toEqual(copy);
    expect(JSON.parse(JSON.stringify(view))).toStrictEqual(view);
  });
});

describe("view.compute growth", () => {
  test("reports stored growth, the needed grain and a per-second feed rate", () => {
    const game = village(oddStepTuning);
    game.state.posting.decrees.harvest = feedDecree();
    game.state.tick = 100;
    setRoster(game, { farm: 8, idle: 2 });
    game.state.posting.economy.growth = 7;

    const { growth } = game.view.compute();

    expect(growth.stored).toBe(7);
    expect(growth.needed).toBe(tuning.economy.grainPerPeasant);
    expect(growth.perSecond).toBeGreaterThan(0);
    expect(growth.perSecond).toBeCloseTo(
      (game.projection.flows().growthPerTick * 1000) / 250,
      12,
    );
  });

  test.each([
    ["below", 39, false],
    ["at", 40, true],
  ])(
    "growth is full only when the population is %s maxPopulation",
    (_n, idle, full) => {
      const game = Game.create(1, tuning);
      setRoster(game, { idle });

      expect(game.view.compute().growth.full).toBe(full);
    },
  );
});
