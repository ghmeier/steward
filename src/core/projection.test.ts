import { describe, expect, test } from "bun:test";
import {
  quietOptions,
  setRoster,
  economyTestTuning as tuning,
} from "../../test/helpers";
import { Game } from "./game";
import { RESOURCES } from "./realm";

const economy = tuning.economy;
const midSpring = 100;
const spring = economy.seasonYield.spring;
const perFarmer = economy.grainPerFarmer;
const perPerson = economy.grainPerPerson;

function villageAt(tick: number, farmers: number, idlers: number, grain = 60) {
  const game = Game.create(1, tuning);
  game.state.tick = tick;
  game.state.posting.desk.nextArrivalTick = 1e9;
  setRoster(game, { farm: farmers, idle: idlers });
  game.state.posting.resources.grain = grain;
  return game;
}

function enactHarvest(game: Game, policy: "sell" | "feed") {
  game.decrees.enact({
    id: "harvest",
    petition: "harvest",
    rules: [],
    otherwise: policy,
  });
}

describe("projectedRates", () => {
  const surplus = 8 * perFarmer * spring - 10 * perPerson;
  const summer = 8 * perFarmer * economy.seasonYield.summer - 10 * perPerson;
  type Row = {
    name: string;
    tick?: number;
    farmers?: number;
    idlers?: number;
    grain?: number;
    decree?: "sell" | "feed";
    grudgeEndsAfter?: number;
    rates: { grain: number; coin?: number };
  };
  // biome-ignore format: one row per case
  const rows: Row[] = [
		{ name: "no decrees: production minus upkeep", rates: { grain: surplus } },
		{ name: "a sell decree turns the surplus into coin and keeps grain flat", decree: "sell", rates: { grain: 0, coin: surplus * economy.grainPrice } },
		{ name: "a feed decree keeps grain flat", decree: "feed", rates: { grain: 0 } },
		{ name: "the last tick of a season uses the next season's yield", tick: economy.ticksPerSeason, rates: { grain: summer } },
		{ name: "a farmer whose grudge ends next tick counts", farmers: 2, idlers: 0, grudgeEndsAfter: 1, rates: { grain: 2 * perFarmer - 2 * perPerson } },
		{ name: "a farmer whose grudge ends a tick later does not count", farmers: 2, idlers: 0, grudgeEndsAfter: 2, rates: { grain: perFarmer - 2 * perPerson } },
		{ name: "empty stores below upkeep project zero, not a negative rate", farmers: 1, idlers: 9, grain: 0, rates: { grain: 0 } },
		{ name: "stocked stores below upkeep project the negative rate", farmers: 1, idlers: 9, rates: { grain: perFarmer * spring - 10 * perPerson } },
	];

  test.each(rows)("$name", (row) => {
    const game = villageAt(
      row.tick ?? midSpring,
      row.farmers ?? 8,
      row.idlers ?? 2,
      row.grain,
    );
    if (row.decree) enactHarvest(game, row.decree);
    const farmer = game.delegates.all[0];
    if (farmer && row.grudgeEndsAfter) {
      farmer.grudgeUntil = game.state.tick + row.grudgeEndsAfter;
    }

    const rates = game.projection.projectedRates();

    expect(rates.grain).toBeCloseTo(row.rates.grain, 12);
    expect(rates.coin).toBeCloseTo(row.rates.coin ?? 0, 12);
  });

  test("does not change the state it projects from, RNG streams included", () => {
    const game = villageAt(midSpring, 8, 2);
    enactHarvest(game, "feed");
    game.state.posting.economy.growth = economy.grainPerPeasant - 0.001;
    const before = structuredClone(game.state);

    game.projection.projectedRates();

    expect(game.state).toEqual(before);
  });

  test("equals the real per-resource change of a step on every tick the desk is unchanged", () => {
    const game = Game.create(7, tuning);
    game.decrees.enact({
      id: "harvest",
      petition: "harvest",
      rules: [
        {
          when: {
            kind: "compare",
            quantity: "grain",
            comparison: "above",
            value: 80,
          },
          policy: "sell",
        },
        { when: { kind: "season", season: "winter" }, policy: "feed" },
      ],
      otherwise: "stockpile",
    });
    game.decrees.enact({
      id: "work",
      petition: "labor",
      rules: [],
      otherwise: "farming",
    });

    let compared = 0;
    for (let i = 0; i < 1500; i++) {
      const { desk } = game.state.posting;
      const deskBefore = [desk.disputes.length, desk.nextDisputeId];
      const before = { ...game.state.posting.resources };
      const projected = game.projection.projectedRates();

      game.steps.step([], quietOptions);

      const after = game.state.posting.desk;
      if (
        after.disputes.length !== deskBefore[0] ||
        after.nextDisputeId !== deskBefore[1]
      ) {
        continue;
      }
      compared += 1;
      for (const resource of RESOURCES) {
        expect(projected[resource]).toBe(
          (game.state.posting.resources[resource] ?? 0) -
            (before[resource] ?? 0),
        );
      }
    }
    expect(compared).toBeGreaterThan(1000);
  });
});

describe("flows growthPerTick", () => {
  test("is the grain fed on the next tick, and zero with no feed decree", () => {
    const fed = villageAt(midSpring, 8, 2);
    enactHarvest(fed, "feed");
    const after = fed.clone();
    after.steps.step([], quietOptions);

    const { growthPerTick } = fed.projection.flows();

    expect(growthPerTick).toBeGreaterThan(0);
    expect(growthPerTick).toBeCloseTo(
      after.state.posting.economy.growth - fed.state.posting.economy.growth,
      12,
    );
    expect(villageAt(midSpring, 8, 2).projection.flows().growthPerTick).toBe(0);
  });

  test("stays the grain fed on a tick that completes a birth", () => {
    const game = villageAt(midSpring, 8, 2);
    enactHarvest(game, "feed");
    const fed = game.projection.flows().growthPerTick;
    game.state.posting.economy.growth = economy.grainPerPeasant - fed / 2;
    const after = game.clone();
    after.steps.step([], quietOptions);

    const { growthPerTick } = game.projection.flows();

    expect(after.delegates.all.length).toBe(game.delegates.all.length + 1);
    expect(growthPerTick).toBeCloseTo(fed, 12);
  });
});
