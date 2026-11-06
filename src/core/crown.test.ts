import { describe, expect, test } from "bun:test";
import {
  contextFor,
  grantUnlocks,
  quietOptions,
  setRoster,
  tuning,
} from "../../test/helpers";
import { type Demand, NO_DEMAND, NO_DEMAND_TICK } from "./crown";
import type { Decree } from "./decree";
import { Game } from "./game";
import type { Resource } from "./realm";
import { CROWN_CORRESPONDENCE, CROWN_PANEL } from "./unlocks";

const { crown: crownTuning } = tuning;
const oreBase = crownTuning.baseAmounts.ore;

function grownAmount(demand: Demand): number {
  return Math.round(
    crownTuning.baseAmounts[demand.resource as Resource] *
      (1 + crownTuning.step),
  );
}

function step(game: Game, count = 1): void {
  game.steps.runSteps(count, [], quietOptions);
}

function promotedGame(): Game {
  const game = Game.create(1, tuning);
  setRoster(game, { idle: tuning.village.promotionPopulation });
  step(game);
  return game;
}

function stepUntilOpen(game: Game): void {
  while (!game.crown.isOpen) step(game);
}

function openDemand(game: Game, resource?: Resource): Demand {
  stepUntilOpen(game);
  const { crown } = game.state.posting;
  if (resource !== undefined && crown.demand.resource !== resource) {
    const amount = crownTuning.baseAmounts[resource];
    crown.demand = { ...crown.demand, resource, amount };
  }
  return crown.demand;
}

function stock(game: Game, resource: string, amount: number): void {
  game.state.posting.resources[resource] = amount;
}

function held(game: Game, resource: string): number {
  return game.state.posting.resources[resource] ?? 0;
}

function deliver(game: Game) {
  return game.commands.apply({ type: "deliver" }, contextFor(game));
}

describe("crown demands", () => {
  test("no demand is issued while the village is unpromoted", () => {
    const game = Game.create(1, tuning);

    step(game, 3 * crownTuning.deadlineTicks);

    expect(game.state.career.promotedAt).toBe(0);
    expect(game.crown.isOpen).toBe(false);
    expect(game.state.posting.crown.nextDemandTick).toBe(NO_DEMAND_TICK);
  });

  test("promotion grants the Crown panel and issues the first demand one first-demand delay later, due one deadline after", () => {
    const game = promotedGame();
    const { promotedAt } = game.state.career;

    step(game, crownTuning.firstDemandTicks - 1);
    const early = game.crown.isOpen;
    step(game);
    const { demand } = game.state.posting.crown;

    expect(Object.hasOwn(game.state.career.unlocks, CROWN_PANEL)).toBe(true);
    expect(early).toBe(false);
    expect(game.crown.isOpen).toBe(true);
    expect(demand.id).not.toBe(NO_DEMAND.id);
    expect(demand.issuedAt).toBe(promotedAt + crownTuning.firstDemandTicks);
    expect(demand.dueAt - demand.issuedAt).toBe(crownTuning.deadlineTicks);
  });

  test("the same resource is never demanded twice in a row", () => {
    const game = promotedGame();
    const drawn: string[] = [];

    for (let i = 0; i < 12; i++) {
      drawn.push(openDemand(game).resource);
      step(game, crownTuning.deadlineTicks);
    }

    for (let i = 1; i < drawn.length; i++) {
      expect(drawn[i]).not.toBe(drawn[i - 1]);
    }
  });
});

describe("delivery", () => {
  test("a partial delivery hands over all the stock, leaves the rest owed and earns no reward", () => {
    const game = promotedGame();
    const demand = openDemand(game, "grain");
    stock(game, "grain", demand.amount / 2);
    stock(game, "coin", 0);

    const result = deliver(game);

    expect(result.ok).toBe(true);
    expect(held(game, "grain")).toBe(0);
    expect(held(game, "coin")).toBe(0);
    expect(game.state.posting.crown.demand.delivered).toBe(demand.amount / 2);
    expect(game.crown.owed).toBe(demand.amount / 2);
    expect(game.state.posting.crown.met).toBe(0);
  });

  test("paying in full before the deadline pays the reward, resolves the demand and grows the next one", () => {
    const game = promotedGame();
    const demand = openDemand(game, "grain");
    stock(game, "grain", demand.amount + 40);
    stock(game, "coin", 0);

    deliver(game);
    const { crown } = game.state.posting;
    const wait = crown.nextDemandTick - game.state.tick;

    expect(held(game, "grain")).toBe(40);
    expect(held(game, "coin")).toBe(crownTuning.reward * demand.amount);
    expect(game.crown.isOpen).toBe(false);
    expect(crown.met).toBe(1);
    expect(crown.missed).toBe(0);
    expect(wait).toBeGreaterThanOrEqual(crownTuning.gap.minTicks);
    expect(wait).toBeLessThanOrEqual(crownTuning.gap.maxTicks);
    const next = openDemand(game);
    expect(next.amount).toBe(grownAmount(next));
  });

  test("is rejected with a reason when no demand is open or the village holds none of the resource", () => {
    const game = promotedGame();

    const beforeDemand = deliver(game);
    const demand = openDemand(game);
    stock(game, demand.resource, 0);
    const emptyStore = deliver(game);

    expect(beforeDemand).toEqual({
      ok: false,
      reason: expect.stringContaining("no demand"),
    });
    expect(emptyStore).toEqual({
      ok: false,
      reason: expect.stringContaining(demand.resource),
    });
    expect(game.state.posting.crown.demand.delivered).toBe(0);
  });
});

describe("collection at the deadline", () => {
  function atDeadline(stocked: number) {
    const game = promotedGame();
    const demand = openDemand(game, "ore");
    stock(game, "ore", stocked);
    stock(game, "coin", 0);
    step(game, demand.dueAt - game.state.tick);
    return { game, demand };
  }

  test("stock that covers the demand is collected and counts as met, with no reward or surcharge, and grows the next demand", () => {
    const { game, demand } = atDeadline(oreBase * 2);
    const { crown } = game.state.posting;

    expect(held(game, "ore")).toBe(oreBase * 2 - demand.amount);
    expect(held(game, "coin")).toBe(0);
    expect(crown.met).toBe(1);
    expect(crown.missed).toBe(0);
    expect(crown.surcharge).toBe(0);
    expect(game.crown.isOpen).toBe(false);
    const next = openDemand(game);
    expect(next.amount).toBe(grownAmount(next));
  });

  test("stock that falls short is all collected, records a miss and surcharges the uncovered part onto the next demand", () => {
    const { game, demand } = atDeadline(oreBase / 4);
    const { crown } = game.state.posting;
    const { surcharge } = crown;

    expect(held(game, "ore")).toBe(0);
    expect(crown.missed).toBe(1);
    expect(crown.met).toBe(0);
    expect(surcharge).toBe(
      crownTuning.surcharge * (demand.amount - oreBase / 4),
    );
    expect(game.crown.isOpen).toBe(false);
    const next = openDemand(game);
    expect(next.amount).toBe(
      Math.round(
        crownTuning.baseAmounts[next.resource as Resource] + surcharge,
      ),
    );
    expect(crown.surcharge).toBe(0);
  });
});

describe("owed quantities", () => {
  test("an owed quantity is the unpaid part of an open demand for its resource and zero for the others", () => {
    const game = promotedGame();
    const demand = openDemand(game, "wood");
    const before = game.conditions.quantityOf("owedWood");
    stock(game, "wood", 10);

    deliver(game);

    expect(before).toBe(demand.amount);
    expect(game.conditions.quantityOf("owedWood")).toBe(demand.amount - 10);
    expect(game.conditions.quantityOf("owedOre")).toBe(0);
    expect(game.conditions.quantityOf("owedGrain")).toBe(0);
    expect(game.conditions.quantityOf("owedCoin")).toBe(0);
  });

  test("decrees may read an owed quantity only after the Archive entry is bought", () => {
    const decree: Decree = {
      id: "ore-rule",
      petition: "labor",
      rules: [
        {
          when: {
            kind: "compare",
            quantity: "owedOre",
            comparison: "above",
            value: 0,
          },
          policy: "mine",
        },
      ],
      otherwise: "farm",
    };
    const locked = Game.create(1, tuning);
    const unlocked = Game.create(1, tuning);
    grantUnlocks(unlocked, [CROWN_CORRESPONDENCE]);

    expect(() => locked.decrees.enact(decree)).toThrow(/Crown correspondence/);
    expect(() => unlocked.decrees.enact(decree)).not.toThrow();
  });
});
