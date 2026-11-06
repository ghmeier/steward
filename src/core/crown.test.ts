import { describe, expect, test } from "bun:test";
import {
  contextFor,
  grantUnlocks,
  quietOptions,
  setRoster,
  tuning,
} from "../../test/helpers";
import { NO_DEMAND, NO_DEMAND_TICK } from "./crown";
import type { Decree } from "./decree";
import { Game } from "./game";
import type { Resource } from "./realm";
import { CROWN_CORRESPONDENCE, CROWN_PANEL } from "./unlocks";

const { crown: crownTuning } = tuning;
const oreBase = crownTuning.baseAmounts.ore;

function step(game: Game, count = 1): void {
  game.steps.runSteps(count, [], quietOptions);
}

/** A village that has just been promoted; the step that promotes it schedules the first demand. */
function promotedGame(): Game {
  const game = Game.create(1, tuning);
  setRoster(game, { idle: tuning.village.promotionPopulation });
  step(game);
  return game;
}

function stepUntilOpen(game: Game): void {
  while (!game.crown.isOpen) step(game);
}

function openDemand(game: Game, resource?: Resource) {
  stepUntilOpen(game);
  const { demand } = game.state.posting.crown;
  if (resource !== undefined && demand.resource !== resource) {
    const base = crownTuning.baseAmounts[resource];
    game.state.posting.crown.demand = { ...demand, resource, amount: base };
  }
  return game.state.posting.crown.demand;
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

  test("promotion grants the Crown panel and the first demand comes one first-demand delay later", () => {
    const game = promotedGame();
    const { promotedAt } = game.state.career;

    step(game, crownTuning.firstDemandTicks - 1);
    const early = game.crown.isOpen;
    step(game);

    expect(Object.hasOwn(game.state.career.unlocks, CROWN_PANEL)).toBe(true);
    expect(early).toBe(false);
    expect(game.crown.isOpen).toBe(true);
    expect(game.state.posting.crown.demand.issuedAt).toBe(
      promotedAt + crownTuning.firstDemandTicks,
    );
  });

  test("a demand's deadline is the deadline length after it was issued", () => {
    const game = promotedGame();

    const demand = openDemand(game);

    expect(demand.dueAt - demand.issuedAt).toBe(crownTuning.deadlineTicks);
    expect(demand.id).not.toBe(NO_DEMAND.id);
  });

  test("the same resource is never demanded twice in a row", () => {
    const game = promotedGame();
    const drawn: string[] = [];

    for (let i = 0; i < 12; i++) {
      drawn.push(openDemand(game).resource);
      step(game, crownTuning.deadlineTicks);
    }

    for (const [index, resource] of drawn.entries()) {
      if (index > 0) expect(resource).not.toBe(drawn[index - 1]);
    }
  });
});

describe("delivery", () => {
  test("a partial delivery hands over all the stock and leaves the rest owed", () => {
    const game = promotedGame();
    const demand = openDemand(game);
    stock(game, demand.resource, demand.amount / 2);

    const result = deliver(game);

    expect(result.ok).toBe(true);
    expect(held(game, demand.resource)).toBe(0);
    expect(game.state.posting.crown.demand.delivered).toBe(demand.amount / 2);
    expect(game.crown.owed).toBe(demand.amount / 2);
    expect(game.state.posting.crown.met).toBe(0);
  });

  test("paying in full before the deadline pays the reward and resolves the demand at once", () => {
    const game = promotedGame();
    const demand = openDemand(game, "grain");
    stock(game, "grain", demand.amount + 40);
    stock(game, "coin", 0);

    deliver(game);

    expect(held(game, "grain")).toBe(40);
    expect(held(game, "coin")).toBe(crownTuning.reward * demand.amount);
    expect(game.crown.isOpen).toBe(false);
    expect(game.state.posting.crown.met).toBe(1);
    expect(game.state.posting.crown.missed).toBe(0);
    const { nextDemandTick } = game.state.posting.crown;
    const wait = nextDemandTick - game.state.tick;
    expect(wait).toBeGreaterThanOrEqual(crownTuning.gap.minTicks);
    expect(wait).toBeLessThanOrEqual(crownTuning.gap.maxTicks);
  });

  test("a partial delivery earns no reward", () => {
    const game = promotedGame();
    const demand = openDemand(game, "grain");
    stock(game, "grain", demand.amount - 1);
    stock(game, "coin", 0);

    deliver(game);

    expect(held(game, "coin")).toBe(0);
  });

  test("is rejected when the crown has made no demand", () => {
    const game = promotedGame();

    const result = deliver(game);

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      reason: expect.stringContaining("no demand"),
    });
  });

  test("is rejected when the village holds none of the resource", () => {
    const game = promotedGame();
    const demand = openDemand(game);
    stock(game, demand.resource, 0);

    const result = deliver(game);

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      reason: expect.stringContaining(demand.resource),
    });
    expect(game.state.posting.crown.demand.delivered).toBe(0);
  });
});

describe("a missed deadline", () => {
  function missedGame(held: number) {
    const game = promotedGame();
    const demand = openDemand(game, "ore");
    stock(game, "ore", held);
    step(game, demand.dueAt - game.state.tick);
    return { game, demand };
  }

  test("seizes the stock toward what is owed, records the miss and surcharges the next demand", () => {
    const { game, demand } = missedGame(oreBase / 4);
    const seized = demand.amount / 4;
    const shortfall = demand.amount - seized;

    const { crown } = game.state.posting;

    expect(held(game, "ore")).toBe(0);
    expect(crown.missed).toBe(1);
    expect(crown.met).toBe(0);
    expect(game.crown.isOpen).toBe(false);
    expect(crown.surcharge).toBe(crownTuning.surcharge * shortfall);
  });

  test("never takes more than the village holds", () => {
    const { game } = missedGame(0);

    expect(held(game, "ore")).toBe(0);
    expect(game.state.posting.crown.missed).toBe(1);
  });

  test("adds the surcharge to the next demand's amount and then clears it", () => {
    const { game } = missedGame(0);
    const { surcharge } = game.state.posting.crown;

    const next = openDemand(game);

    expect(next.amount).toBe(
      Math.round(
        crownTuning.baseAmounts[next.resource as Resource] + surcharge,
      ),
    );
    expect(game.state.posting.crown.surcharge).toBe(0);
  });

  test("a demand covered by seizure alone is still recorded as missed with no surcharge", () => {
    const { game, demand } = missedGame(oreBase * 2);

    expect(held(game, "ore")).toBe(oreBase * 2 - demand.amount);
    expect(game.state.posting.crown.missed).toBe(1);
    expect(game.state.posting.crown.surcharge).toBe(0);
  });
});

describe("a met demand", () => {
  test("raises the next demand's amount by the step", () => {
    const game = promotedGame();
    const first = openDemand(game, "grain");
    stock(game, "grain", first.amount);
    deliver(game);

    const next = openDemand(game);

    expect(next.amount).toBe(
      Math.round(
        crownTuning.baseAmounts[next.resource as Resource] *
          (1 + crownTuning.step),
      ),
    );
  });
});

describe("owed quantities", () => {
  test("an owed quantity is zero unless the open demand is for that resource", () => {
    const game = promotedGame();
    const demand = openDemand(game, "wood");

    expect(game.conditions.quantityOf("owedWood")).toBe(demand.amount);
    expect(game.conditions.quantityOf("owedOre")).toBe(0);
    expect(game.conditions.quantityOf("owedGrain")).toBe(0);
    expect(game.conditions.quantityOf("owedCoin")).toBe(0);
  });

  test("an owed quantity drops as the demand is paid", () => {
    const game = promotedGame();
    const demand = openDemand(game, "wood");
    stock(game, "wood", 10);
    deliver(game);

    expect(game.conditions.quantityOf("owedWood")).toBe(demand.amount - 10);
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
