import { describe, expect, test } from "bun:test";
import {
  contextFor,
  grantUnlocks,
  quietOptions,
  setRoster,
  tuning,
} from "../../test/helpers";
import type { Command } from "./commands";
import { Game } from "./game";
import { NO_DEBT_TICK } from "./illusion";
import type { Resource } from "./realm";
import { ARCHIVE_PANEL, CONJURING } from "./unlocks";

const { illusion: illusionTuning, crown: crownTuning } = tuning;
const palette = tuning.archive.entries.find(
  (entry) => entry.id === "control.palette",
);
if (palette === undefined) throw new Error("the palette entry is missing");

function village(peasants = tuning.village.promotionPopulation): Game {
  const game = Game.create(1, tuning);
  setRoster(game, { idle: peasants });
  grantUnlocks(game, [CONJURING]);
  return game;
}

function command(game: Game, issued: Command) {
  game.state.tick += 1;
  return game.commands.apply(issued, contextFor(game));
}

function openDemand(game: Game, resource: Resource, amount: number): void {
  game.state.posting.crown.demand = {
    id: 1,
    resource,
    amount,
    delivered: 0,
    issuedAt: game.state.tick,
    dueAt: game.state.tick + crownTuning.deadlineTicks,
  };
}

function stock(game: Game, resource: string, amount: number): void {
  game.state.posting.resources[resource] = amount;
}

function conjured(game: Game, resource: string): number {
  return game.state.posting.illusion.conjured[resource] ?? 0;
}

function debt(game: Game, resource: string): number {
  return game.state.posting.illusion.debt[resource] ?? 0;
}

function step(game: Game, count = 1): void {
  game.steps.runSteps(count, [], quietOptions);
}

describe("spending on outsiders", () => {
  test("conjured units are spent before real stock and the conjured part becomes debt", () => {
    const game = village();
    const { illusion } = game.state.posting;
    illusion.conjured.grain = 40;
    stock(game, "grain", 100);

    game.illusion.spend("grain", 70, contextFor(game));

    expect(conjured(game, "grain")).toBe(0);
    expect(debt(game, "grain")).toBe(40);
    expect(game.state.posting.resources.grain).toBe(70);
    expect(illusion.debtSince).toBe(game.state.tick);
  });

  test("real stock alone creates no debt", () => {
    const game = village();
    stock(game, "grain", 100);

    game.illusion.spend("grain", 70, contextFor(game));

    expect(debt(game, "grain")).toBe(0);
    expect(game.state.posting.illusion.debtSince).toBe(NO_DEBT_TICK);
  });

  test("conjured grain delivered to the crown becomes debt, and delivering real grain does not", () => {
    const game = village();
    openDemand(game, "grain", crownTuning.baseAmounts.grain);
    stock(game, "grain", 0);
    game.state.posting.illusion.conjured.grain = 50;

    const withIllusion = command(game, { type: "deliver" });
    const real = village();
    openDemand(real, "grain", crownTuning.baseAmounts.grain);
    stock(real, "grain", 50);
    command(real, { type: "deliver" });

    expect(withIllusion.ok).toBe(true);
    expect(debt(game, "grain")).toBe(50);
    expect(game.state.posting.crown.demand.delivered).toBe(50);
    expect(debt(real, "grain")).toBe(0);
    expect(real.state.posting.crown.demand.delivered).toBe(50);
  });

  test("peasants do not eat conjured grain, so real grain alone decides famine", () => {
    const hungry = village();
    stock(hungry, "grain", 0);
    hungry.state.posting.illusion.conjured.grain = 1000;
    const fed = village();
    stock(fed, "grain", 1000);

    step(hungry);
    step(fed);

    expect(hungry.state.posting.economy.famine.ticks).toBe(1);
    expect(hungry.state.posting.resources.grain).toBe(0);
    expect(conjured(hungry, "grain")).toBeGreaterThan(0);
    expect(fed.state.posting.economy.famine.ticks).toBe(0);
  });

  test("the Archive accepts conjured coin, which becomes debt, and refuses when real and conjured coin together fall short", () => {
    const game = village();
    grantUnlocks(game, [ARCHIVE_PANEL]);
    stock(game, "coin", 0);
    game.state.posting.illusion.conjured.coin = palette.cost;
    const poor = village();
    grantUnlocks(poor, [ARCHIVE_PANEL]);
    stock(poor, "coin", 0);
    poor.state.posting.illusion.conjured.coin = palette.cost - 1;

    game.unlocks.buy(palette.id, contextFor(game));

    expect(game.unlocks.enabled(palette.id)).toBe(true);
    expect(debt(game, "coin")).toBe(palette.cost);
    expect(() => poor.unlocks.buy(palette.id, contextFor(poor))).toThrow(
      "enough coin",
    );
  });

  test("a merchant option accepts conjured coin, which becomes debt, and is refused without it", () => {
    const template = tuning.desk.kinds.merchant.templates.find(
      (candidate) => candidate.id === "grain-factor",
    );
    const option = template?.options.find(
      (candidate) => candidate.id === "buy-cart",
    );
    const price = -(option?.resources?.coin ?? 0);
    const entry = {
      id: 1,
      kind: "merchant",
      template: "grain-factor",
      arrivedAt: 0,
    } as const;
    const game = village();
    const broke = village();
    for (const each of [game, broke]) {
      each.state.posting.desk.disputes = [entry];
      each.state.posting.desk.nextDisputeId = 2;
      stock(each, "coin", 0);
    }
    game.state.posting.illusion.conjured.coin = price;

    const accepted = game.desk.settle(1, "buy-cart", contextFor(game));
    const refused = broke.desk.settle(1, "buy-cart", contextFor(broke));

    expect(price).toBeGreaterThan(0);
    expect(accepted.ok).toBe(true);
    expect(debt(game, "coin")).toBe(price);
    expect(refused.ok).toBe(false);
  });
});

describe("conjuring", () => {
  test("conjuring within the room adds conjured stock and conjuring past it is refused naming the room", () => {
    const game = village();
    const room = game.illusion.room;

    const within = command(game, {
      type: "conjure",
      resource: "coin",
      amount: room,
    });
    const past = command(game, {
      type: "conjure",
      resource: "grain",
      amount: 1,
    });

    expect(within.ok).toBe(true);
    expect(conjured(game, "coin")).toBe(room);
    expect(past.ok).toBe(false);
    expect(past.ok === false && past.reason).toContain(
      String(Math.floor(game.illusion.room)),
    );
    expect(conjured(game, "grain")).toBe(0);
  });

  test("the room is priced in coin, so a unit of grain costs its market price", () => {
    const game = village();
    const room = game.illusion.room;
    const grainPrice = tuning.economy.grainPrice;

    const result = command(game, {
      type: "conjure",
      resource: "grain",
      amount: room / grainPrice,
    });

    expect(result.ok).toBe(true);
    expect(game.illusion.room).toBeCloseTo(0, 9);
  });

  test("ore, wood and non-positive amounts are refused", () => {
    const game = village();

    const ore = command(game, { type: "conjure", resource: "ore", amount: 1 });
    const wood = command(game, {
      type: "conjure",
      resource: "wood",
      amount: 1,
    });
    const none = command(game, {
      type: "conjure",
      resource: "coin",
      amount: 0,
    });
    const negative = command(game, {
      type: "conjure",
      resource: "coin",
      amount: -5,
    });

    expect([ore, wood, none, negative].map((result) => result.ok)).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(game.illusion.exposure).toBe(0);
  });

  test("every command is refused before conjuring is unlocked", () => {
    const game = village();
    delete game.state.career.unlocks[CONJURING];
    openDemand(game, "grain", 100);
    game.state.posting.illusion.debt.grain = 5;
    stock(game, "grain", 5);

    const results = [
      command(game, { type: "conjure", resource: "coin", amount: 1 }),
      command(game, { type: "forge" }),
      command(game, { type: "back", resource: "grain" }),
    ];

    expect(results.map((result) => result.ok)).toEqual([false, false, false]);
    expect(game.illusion.exposure).toBe(5 * tuning.economy.grainPrice);
    expect(game.state.posting.crown.demand.delivered).toBe(0);
  });

  test("the first crown demand grants conjuring, and nothing before it does", () => {
    const game = Game.create(1, tuning);
    setRoster(game, { idle: tuning.village.promotionPopulation });
    step(game);
    const before = game.unlocks.enabled(CONJURING);

    while (!game.crown.isOpen) step(game);

    expect(before).toBe(false);
    expect(game.unlocks.enabled(CONJURING)).toBe(true);
    expect(game.state.career.unlocks[CONJURING]).toBe(
      game.state.posting.crown.demand.issuedAt,
    );
  });
});

describe("forging a report", () => {
  test("a forged report that completes the demand counts as met, earns the reward and records the debt", () => {
    const game = village();
    const amount = crownTuning.baseAmounts.grain;
    openDemand(game, "grain", amount);
    stock(game, "coin", 0);
    stock(game, "grain", 0);

    const result = command(game, { type: "forge" });

    expect(result.ok).toBe(true);
    expect(game.state.posting.crown.met).toBe(1);
    expect(game.crown.isOpen).toBe(false);
    expect(game.state.posting.resources.coin).toBe(crownTuning.reward * amount);
    expect(game.state.posting.resources.grain).toBe(0);
    expect(debt(game, "grain")).toBe(amount);
    expect(game.state.posting.illusion.debtSince).toBe(game.state.tick);
  });

  test("a forged report limited by the room leaves the demand open with only the room forged", () => {
    const game = village(4);
    openDemand(game, "grain", crownTuning.baseAmounts.grain);
    const forgeable = game.illusion.room / tuning.economy.grainPrice;

    const result = command(game, { type: "forge" });

    expect(forgeable).toBeLessThan(crownTuning.baseAmounts.grain);
    expect(result.ok).toBe(true);
    expect(game.crown.isOpen).toBe(true);
    expect(game.state.posting.crown.demand.delivered).toBe(forgeable);
    expect(debt(game, "grain")).toBe(forgeable);
    expect(game.state.posting.crown.met).toBe(0);
    expect(game.state.posting.resources.coin).toBe(
      tuning.economy.initialResources.coin,
    );
  });

  test("is refused with no open demand and with no room", () => {
    const game = village();
    const idle = command(game, { type: "forge" });
    openDemand(game, "grain", crownTuning.baseAmounts.grain);
    game.state.posting.illusion.conjured.coin = game.illusion.room;

    const full = command(game, { type: "forge" });

    expect(idle.ok).toBe(false);
    expect(full.ok).toBe(false);
    expect(game.state.posting.crown.demand.delivered).toBe(0);
  });
});

describe("backing debt", () => {
  test("repays debt from real stock only as far as the stock reaches", () => {
    const game = village();
    const { illusion } = game.state.posting;
    illusion.debt.grain = 50;
    illusion.debtSince = 1;
    stock(game, "grain", 30);

    const result = command(game, { type: "back", resource: "grain" });

    expect(result.ok).toBe(true);
    expect(game.state.posting.resources.grain).toBe(0);
    expect(debt(game, "grain")).toBe(20);
    expect(illusion.debtSince).toBe(1);
  });

  test("clears the debt sentinel when the last debt is repaid", () => {
    const game = village();
    const { illusion } = game.state.posting;
    illusion.debt.grain = 10;
    illusion.debtSince = 1;
    stock(game, "grain", 25);

    command(game, { type: "back", resource: "grain" });

    expect(debt(game, "grain")).toBe(0);
    expect(game.state.posting.resources.grain).toBe(15);
    expect(illusion.debtSince).toBe(NO_DEBT_TICK);
  });

  test("never draws on conjured stock, so conjured stock alone cannot back a debt", () => {
    const game = village();
    const { illusion } = game.state.posting;
    illusion.debt.grain = 10;
    illusion.debtSince = 1;
    illusion.conjured.grain = 500;
    stock(game, "grain", 0);

    const result = command(game, { type: "back", resource: "grain" });

    expect(result.ok).toBe(false);
    expect(debt(game, "grain")).toBe(10);
    expect(conjured(game, "grain")).toBe(500);
  });

  test("is refused for a resource with no debt", () => {
    const game = village();
    stock(game, "grain", 100);

    const result = command(game, { type: "back", resource: "grain" });

    expect(result.ok).toBe(false);
    expect(game.state.posting.resources.grain).toBe(100);
  });
});

describe("fading and interest", () => {
  test("conjured stock fades and debt grows by the tuned fractions every tick without touching real stock or the random streams", () => {
    const game = village();
    const { illusion, rng } = game.state.posting;
    illusion.conjured.coin = 100;
    illusion.debt.ore = 100;
    illusion.debtSince = 1;
    const streams = structuredClone(rng);
    const ticks = 600;

    for (let i = 0; i < ticks; i++) game.illusion.run();

    expect(conjured(game, "coin")).toBeCloseTo(
      100 * (1 - illusionTuning.fadePerTick) ** ticks,
      9,
    );
    expect(debt(game, "ore")).toBeCloseTo(
      100 * (1 + illusionTuning.interestPerTick) ** ticks,
      9,
    );
    expect(debt(game, "coin")).toBe(0);
    expect(rng).toEqual(streams);
  });

  test("a step runs the fade after the village's own flows", () => {
    const game = village();
    game.state.posting.illusion.conjured.grain = 100;

    step(game);

    expect(conjured(game, "grain")).toBe(
      100 * (1 - illusionTuning.fadePerTick),
    );
  });
});

describe("exposure", () => {
  test("is the coin value of conjured stock and debt, and the room is what the ceiling leaves, never below zero", () => {
    const game = village();
    const { illusion } = game.state.posting;
    illusion.conjured.grain = 100;
    illusion.debt.ore = 10;
    illusion.debt.wood = 10;
    illusion.debt.coin = 7;

    const { economy } = tuning;
    const expected =
      100 * economy.grainPrice +
      10 * economy.orePrice +
      10 * economy.woodPrice +
      7;

    expect(game.illusion.exposure).toBeCloseTo(expected, 9);
    expect(game.illusion.ceiling).toBe(
      illusionTuning.ceilingPerPeasant * tuning.village.promotionPopulation,
    );
    expect(game.illusion.room).toBeCloseTo(game.illusion.ceiling - expected, 9);
    illusion.debt.coin = game.illusion.ceiling * 2;
    expect(game.illusion.room).toBe(0);
  });

  test("the decree quantity debt reads the coin value of all debt and ignores conjured stock", () => {
    const game = village();
    game.state.posting.illusion.debt.ore = 10;
    game.state.posting.illusion.conjured.coin = 99;

    expect(game.conditions.quantityOf("debt")).toBe(
      10 * tuning.economy.orePrice,
    );
  });
});

describe("the view", () => {
  test("shows nothing of the illusion until conjuring is unlocked", () => {
    const game = village();
    delete game.state.career.unlocks[CONJURING];

    expect(game.view.compute().illusion).toBeNull();
    grantUnlocks(game, [CONJURING]);
    expect(game.view.compute().illusion).not.toBeNull();
  });

  test("the ledger shows the apparent amount with the conjured part beside it", () => {
    const game = village();
    stock(game, "grain", 30);
    game.state.posting.illusion.conjured.grain = 12;

    const grain = game.view
      .compute()
      .ledger.find((line) => line.resource === "grain");

    expect(grain?.amount).toBe(42);
    expect(grain?.conjured).toBe(12);
  });

  test("the books read clean at no exposure, then thin, strained and rotten by the share of the ceiling", () => {
    const game = village();
    const { ceiling } = game.illusion;
    const { strained, rotten } = illusionTuning.books;
    const booksAt = (share: number) => {
      game.state.posting.illusion.conjured.coin = ceiling * share;
      return game.view.compute().illusion?.books;
    };

    expect(booksAt(0)).toBe("clean");
    expect(booksAt(strained / 2)).toBe("thin");
    expect(booksAt(strained)).toBe("strained");
    expect(booksAt((strained + rotten) / 2)).toBe("strained");
    expect(booksAt(rotten)).toBe("rotten");
    expect(game.view.compute().illusion?.auditInTicks).toBeNull();
  });

  test("an option is affordable with conjured coin and not without it", () => {
    const game = village();
    grantUnlocks(game, [ARCHIVE_PANEL]);
    stock(game, "coin", 0);
    const affordable = () =>
      game.view.compute().archive.entries.find((e) => e.id === palette.id)
        ?.affordable;

    const before = affordable();
    game.state.posting.illusion.conjured.coin = palette.cost;

    expect(before).toBe(false);
    expect(affordable()).toBe(true);
  });
});
