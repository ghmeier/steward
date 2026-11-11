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
  test("spend takes conjured units first and turns them into debt, while real stock alone creates none", () => {
    const game = village();
    const { illusion } = game.state.posting;
    illusion.conjured.grain = 40;
    stock(game, "grain", 100);
    const spent = 70;

    game.illusion.spend("grain", spent, contextFor(game));

    expect(conjured(game, "grain")).toBe(0);
    expect(debt(game, "grain")).toBe(40);
    expect(game.state.posting.resources.grain).toBe(100 - (spent - 40));
    expect(illusion.debtSince).toBe(game.state.tick);

    const real = village();
    stock(real, "grain", 100);

    real.illusion.spend("grain", spent, contextFor(real));

    expect(debt(real, "grain")).toBe(0);
    expect(real.state.posting.illusion.debtSince).toBe(NO_DEBT_TICK);
  });

  test("conjured grain delivered to the crown becomes debt, and delivering real grain does not", () => {
    const amount = crownTuning.baseAmounts.grain;
    const game = village();
    openDemand(game, "grain", amount);
    stock(game, "grain", 0);
    game.state.posting.illusion.conjured.grain = amount / 2;
    const real = village();
    openDemand(real, "grain", amount);
    stock(real, "grain", amount / 2);

    const withIllusion = command(game, { type: "deliver" });
    command(real, { type: "deliver" });

    expect(withIllusion.ok).toBe(true);
    expect(debt(game, "grain")).toBe(amount / 2);
    expect(game.state.posting.crown.demand.delivered).toBe(amount / 2);
    expect(debt(real, "grain")).toBe(0);
    expect(real.state.posting.crown.demand.delivered).toBe(amount / 2);
  });

  test("peasants do not eat conjured grain, so real grain alone decides famine", () => {
    const hungry = village();
    stock(hungry, "grain", 0);
    hungry.state.posting.illusion.conjured.grain = 1000;
    const fed = village();
    stock(fed, "grain", 1000);

    step(hungry);
    step(fed);

    expect(hungry.state.posting.economy.famine.ticks).toBeGreaterThan(0);
    expect(hungry.state.posting.resources.grain).toBe(0);
    expect(conjured(hungry, "grain")).toBeGreaterThan(0);
    expect(fed.state.posting.economy.famine.ticks).toBe(0);
  });

  test("the Archive accepts conjured coin as debt, and refuses when real and conjured coin together fall short", () => {
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

  test("a merchant option accepts conjured coin as debt and is refused without it", () => {
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
  test("conjuring up to the room adds conjured stock priced in coin, and conjuring past it is refused naming the room", () => {
    const game = village();
    const room = game.illusion.room;

    const within = command(game, {
      type: "conjure",
      resource: "grain",
      amount: room / tuning.economy.grainPrice,
    });
    const past = command(game, {
      type: "conjure",
      resource: "coin",
      amount: 1,
    });

    expect(within.ok).toBe(true);
    expect(conjured(game, "grain")).toBe(room / tuning.economy.grainPrice);
    expect(game.illusion.room).toBeCloseTo(0, 9);
    expect(past.ok).toBe(false);
    expect(past.ok === false && past.reason).toContain(
      String(Math.floor(game.illusion.room)),
    );
    expect(conjured(game, "coin")).toBe(0);
  });

  test("ore, wood and non-positive amounts are refused", () => {
    const game = village();
    const attempts = [
      { resource: "ore", amount: 1 },
      { resource: "wood", amount: 1 },
      { resource: "coin", amount: 0 },
      { resource: "coin", amount: -5 },
    ] as const;

    const results = attempts.map((attempt) =>
      command(game, { type: "conjure", ...attempt }),
    );

    expect(results.map((result) => result.ok)).toEqual(
      attempts.map(() => false),
    );
    expect(game.illusion.conjuredValue).toBe(0);
  });

  test("every command is refused until the first crown demand grants conjuring", () => {
    const game = Game.create(1, tuning);
    setRoster(game, { idle: tuning.village.promotionPopulation });
    game.state.posting.illusion.debt.grain = 5;
    stock(game, "grain", 5);
    const locked = () => [
      command(game, { type: "conjure", resource: "coin", amount: 1 }),
      command(game, { type: "forge" }),
      command(game, { type: "back", resource: "grain" }),
    ];

    const before = locked();
    const grainAfterRefusal = game.state.posting.resources.grain;
    while (!game.crown.isOpen) step(game);

    expect(before.map((result) => result.ok)).toEqual([false, false, false]);
    expect(grainAfterRefusal).toBe(5);
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

  test("a forged report forges only what the room allows, and is refused with no open demand or no room", () => {
    const idle = village();
    const none = command(idle, { type: "forge" });
    const game = village(4);
    openDemand(game, "grain", crownTuning.baseAmounts.grain);
    const forgeable = game.illusion.room / tuning.economy.grainPrice;

    const limited = command(game, { type: "forge" });
    const full = command(game, { type: "forge" });

    expect(none.ok).toBe(false);
    expect(forgeable).toBeLessThan(crownTuning.baseAmounts.grain);
    expect(limited.ok).toBe(true);
    expect(game.crown.isOpen).toBe(true);
    expect(game.state.posting.crown.demand.delivered).toBe(forgeable);
    expect(debt(game, "grain")).toBe(forgeable);
    expect(game.state.posting.crown.met).toBe(0);
    expect(game.state.posting.resources.coin).toBe(
      tuning.economy.initialResources.coin,
    );
    expect(full.ok).toBe(false);
    expect(game.state.posting.crown.demand.delivered).toBe(forgeable);
  });
});

describe("backing debt", () => {
  test("repays debt from real stock as far as it reaches, and clears the debt sentinel with the last debt", () => {
    const game = village();
    const { illusion } = game.state.posting;
    illusion.debt.grain = 50;
    illusion.debtSince = 1;
    stock(game, "grain", 30);

    const partial = command(game, { type: "back", resource: "grain" });

    expect(partial.ok).toBe(true);
    expect(game.state.posting.resources.grain).toBe(0);
    expect(debt(game, "grain")).toBe(20);
    expect(illusion.debtSince).toBe(1);

    stock(game, "grain", 25);

    command(game, { type: "back", resource: "grain" });

    expect(debt(game, "grain")).toBe(0);
    expect(game.state.posting.resources.grain).toBe(5);
    expect(illusion.debtSince).toBe(NO_DEBT_TICK);
  });

  test("is refused without real stock, even with conjured stock, and for a resource with no debt", () => {
    const game = village();
    const { illusion } = game.state.posting;
    illusion.debt.grain = 10;
    illusion.debtSince = 1;
    illusion.conjured.grain = 500;
    stock(game, "grain", 0);
    stock(game, "coin", 100);

    const unbacked = command(game, { type: "back", resource: "grain" });
    const nothingOwed = command(game, { type: "back", resource: "coin" });

    expect(unbacked.ok).toBe(false);
    expect(debt(game, "grain")).toBe(10);
    expect(conjured(game, "grain")).toBe(500);
    expect(nothingOwed.ok).toBe(false);
    expect(game.state.posting.resources.coin).toBe(100);
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

  test("a step fades conjured stock", () => {
    const game = village();
    game.state.posting.illusion.conjured.grain = 100;

    step(game);

    expect(conjured(game, "grain")).toBe(
      100 * (1 - illusionTuning.fadePerTick),
    );
  });
});

describe("exposure", () => {
  test("the room is what the ceiling leaves after the coin value of conjured stock and debt, never below zero, and the debt quantity ignores conjured stock", () => {
    const game = village();
    const { illusion } = game.state.posting;
    const { economy } = tuning;
    illusion.conjured.grain = 100;
    illusion.debt.ore = 10;
    illusion.debt.wood = 10;
    illusion.debt.coin = 7;
    const debtValue = 10 * economy.orePrice + 10 * economy.woodPrice + 7;
    const exposure = 100 * economy.grainPrice + debtValue;

    expect(game.illusion.ceiling).toBe(
      illusionTuning.ceilingPerPeasant * tuning.village.promotionPopulation,
    );
    expect(game.illusion.room).toBeCloseTo(game.illusion.ceiling - exposure, 9);
    expect(game.illusion.debtValue).toBeCloseTo(debtValue, 9);
    expect(game.conditions.quantityOf("debt")).toBeCloseTo(debtValue, 9);

    illusion.debt.coin = game.illusion.ceiling * 2;

    expect(game.illusion.room).toBe(0);
  });
});

describe("the view", () => {
  test("shows the illusion only once conjuring is unlocked, and reads the books by the share of the ceiling", () => {
    const game = village();
    delete game.state.career.unlocks[CONJURING];
    const locked = game.view.compute().illusion;
    grantUnlocks(game, [CONJURING]);
    const { ceiling } = game.illusion;
    const { strained, rotten } = illusionTuning.books;
    const booksAt = (share: number) => {
      game.state.posting.illusion.conjured.coin = ceiling * share;
      return game.view.compute().illusion?.books;
    };

    expect(locked).toBeNull();
    expect(booksAt(0)).toBe("clean");
    expect(booksAt(strained / 2)).toBe("thin");
    expect(booksAt(strained)).toBe("strained");
    expect(booksAt((strained + rotten) / 2)).toBe("strained");
    expect(booksAt(rotten)).toBe("rotten");
    expect(game.view.compute().illusion?.auditInTicks).toBeNull();
  });

  test("the ledger shows the apparent amount with the conjured part beside it", () => {
    const game = village();
    const real = 30;
    const faded = 12;
    stock(game, "grain", real);
    game.state.posting.illusion.conjured.grain = faded;

    const grain = game.view
      .compute()
      .ledger.find((line) => line.resource === "grain");

    expect(grain?.amount).toBe(real + faded);
    expect(grain?.conjured).toBe(faded);
  });

  test("an Archive entry is affordable with conjured coin and not without it", () => {
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
