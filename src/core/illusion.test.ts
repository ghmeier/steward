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
import { NO_AUDIT_TICK, NO_DEBT_TICK } from "./illusion";
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

describe("audits", () => {
  const { audit: auditTuning } = illusionTuning;

  function indebted(coinValue: number, since = 1): Game {
    const game = village();
    game.state.tick = since;
    game.state.posting.illusion.debt.coin = coinValue;
    game.state.posting.illusion.debtSince = since;
    return game;
  }

  function nextTick(game: Game): void {
    game.state.tick += 1;
    game.illusion.run();
  }

  function placeAudit(game: Game): {
    id: number;
    dueAt: number;
    template: string;
  } {
    game.desk.placeAudit(game.state.tick + auditTuning.deadlineTicks);
    const entry = game.state.posting.desk.disputes.at(-1);
    if (entry?.kind !== "audit") throw new Error("no audit was placed");
    return entry;
  }

  function settleAudit(game: Game, optionId: string) {
    const { id } = placeAudit(game);
    return command(game, {
      type: "settleDispute",
      dispute: id,
      option: optionId,
    });
  }

  function auditsOnDesk(game: Game): number {
    return game.state.posting.desk.disputes.filter(
      (entry) => entry.kind === "audit",
    ).length;
  }

  test("auditors are announced once debt reaches its share of the ceiling or its age limit, and never on a clean ledger", () => {
    const byShare = indebted(1);
    const threshold = auditTuning.debtShare * byShare.illusion.ceiling;
    const byAge = indebted(1, 1);
    const clean = village(0);

    byShare.state.posting.illusion.debt.coin = threshold * 0.99;
    nextTick(byShare);
    const belowShare = byShare.illusion.auditInTicks;
    byShare.state.posting.illusion.debt.coin = threshold;
    nextTick(byShare);
    byAge.state.tick = auditTuning.ageTicks;
    byAge.illusion.run();
    const young = byAge.illusion.auditInTicks;
    nextTick(byAge);
    nextTick(clean);

    expect(belowShare).toBeNull();
    expect(young).toBeNull();
    expect(byShare.illusion.auditInTicks).toBe(auditTuning.warningTicks);
    expect(byAge.illusion.auditInTicks).toBe(auditTuning.warningTicks);
    expect(clean.illusion.auditInTicks).toBeNull();
  });

  test("auditors arrive at the announced tick, and no second warning is given while they wait", () => {
    const game = indebted(auditTuning.debtShare * village().illusion.ceiling);
    nextTick(game);
    const arrival = game.state.posting.illusion.auditAt;

    game.state.tick = arrival - 1;
    game.illusion.run();
    const before = auditsOnDesk(game);
    nextTick(game);
    const [entry] = game.state.posting.desk.disputes;
    nextTick(game);

    expect(before).toBe(0);
    expect(entry).toMatchObject({
      kind: "audit",
      dueAt: arrival + auditTuning.deadlineTicks,
    });
    expect(game.state.posting.illusion.auditAt).toBe(NO_AUDIT_TICK);
    expect(auditsOnDesk(game)).toBe(1);
  });

  test("repaying the debt during the warning means nothing arrives", () => {
    const game = indebted(auditTuning.debtShare * village().illusion.ceiling);
    stock(game, "coin", 1e6);
    nextTick(game);
    const arrival = game.state.posting.illusion.auditAt;

    command(game, { type: "back", resource: "coin" });
    game.state.tick = arrival;
    game.illusion.run();

    expect(auditsOnDesk(game)).toBe(0);
    expect(game.state.posting.illusion.auditAt).toBe(NO_AUDIT_TICK);
  });

  test("an audit is passed without a failure once the debt is repaid, even on its deadline, and stands while debt remains", () => {
    const owing = indebted(100);
    placeAudit(owing);
    const repaid = indebted(100);
    stock(repaid, "coin", 1000);
    const { dueAt } = placeAudit(repaid);
    command(repaid, { type: "back", resource: "coin" });
    repaid.state.tick = dueAt;

    nextTick(owing);
    repaid.desk.run(contextFor(repaid));
    repaid.illusion.run();

    expect(auditsOnDesk(owing)).toBe(1);
    expect(owing.state.posting.illusion.audits.backed).toBe(0);
    expect(auditsOnDesk(repaid)).toBe(0);
    expect(repaid.state.posting.illusion.audits).toEqual({
      backed: 1,
      deepened: 0,
      failed: 0,
    });
    expect(repaid.state.posting.crown.missed).toBe(0);
    expect(repaid.desk.expired).toEqual([]);
  });

  test("backing an audit pays every debt from real stock, and is refused when real stock falls short even with conjured stock to spare", () => {
    const covered = indebted(100);
    covered.state.posting.illusion.debt.grain = 40;
    stock(covered, "coin", 150);
    stock(covered, "grain", 40);
    const short = indebted(100);
    stock(short, "coin", 60);
    short.state.posting.illusion.conjured.coin = 500;
    const shortEntry = placeAudit(short);

    const paid = settleAudit(covered, "back");
    const refused = command(short, {
      type: "settleDispute",
      dispute: shortEntry.id,
      option: "back",
    });
    const options = short.view.compute().desk[0]?.options;

    expect(paid).toEqual({ ok: true });
    expect(covered.state.posting.resources.coin).toBeCloseTo(50, 9);
    expect(covered.state.posting.resources.grain).toBe(0);
    expect(debt(covered, "coin")).toBe(0);
    expect(debt(covered, "grain")).toBe(0);
    expect(covered.state.posting.illusion.debtSince).toBe(NO_DEBT_TICK);
    expect(covered.state.posting.illusion.audits.backed).toBe(1);
    expect(auditsOnDesk(covered)).toBe(0);
    expect(refused.ok).toBe(false);
    expect(short.state.posting.resources.coin).toBe(60);
    expect(auditsOnDesk(short)).toBe(1);
    expect(options?.map((option) => option.affordable)).toEqual([false, true]);
    expect(options?.map((option) => option.expiry)).toEqual([false, false]);
    expect(options?.[0]?.resources).toEqual({ coin: -100 });
  });

  test("a deeper illusion costs real coin, multiplies every debt and restarts the debt's age, and cannot be paid with conjured coin", () => {
    const funded = indebted(100, 5);
    funded.state.posting.illusion.debt.grain = 40;
    const value = funded.illusion.debtValue;
    stock(funded, "coin", 1000);
    funded.state.tick = 50;
    const broke = indebted(100);
    stock(broke, "coin", 1);
    broke.state.posting.illusion.conjured.coin = 500;

    const deepened = settleAudit(funded, "deepen");
    const refused = settleAudit(broke, "deepen");

    expect(deepened).toEqual({ ok: true });
    expect(funded.state.posting.resources.coin).toBeCloseTo(
      1000 - auditTuning.deepenCost * value,
      9,
    );
    expect(debt(funded, "coin")).toBeCloseTo(100 * auditTuning.deepenGrowth, 9);
    expect(debt(funded, "grain")).toBeCloseTo(40 * auditTuning.deepenGrowth, 9);
    expect(funded.state.posting.illusion.debtSince).toBe(funded.state.tick);
    expect(funded.state.posting.illusion.audits.deepened).toBe(1);
    expect(refused.ok).toBe(false);
    expect(debt(broke, "coin")).toBe(100);
  });

  test("a lapsed audit seizes the stock it reaches, clears the debt, and records a miss only for the value left uncovered", () => {
    const covered = indebted(100);
    stock(covered, "coin", 130);
    const coveredEntry = placeAudit(covered);
    const lapsedLine = tuning.desk.kinds.audit.templates.find(
      (template) => template.id === coveredEntry.template,
    )?.expired as string;
    covered.state.tick = coveredEntry.dueAt;
    const short = indebted(100);
    short.state.posting.illusion.debt.ore = 30;
    stock(short, "coin", 100);
    stock(short, "ore", 10);
    openDemand(short, "grain", 300);
    const demand = structuredClone(short.state.posting.crown.demand);
    const shortEntry = placeAudit(short);
    short.state.tick = shortEntry.dueAt;
    const uncovered = 20 * short.economy.priceOf("ore");

    covered.desk.run(contextFor(covered));
    short.desk.run(contextFor(short));

    expect(covered.state.posting.resources.coin).toBeCloseTo(30, 9);
    expect(debt(covered, "coin")).toBe(0);
    expect(covered.state.posting.illusion.debtSince).toBe(NO_DEBT_TICK);
    expect(covered.state.posting.illusion.audits.failed).toBe(1);
    expect(covered.state.posting.crown.missed).toBe(0);
    expect(covered.desk.expired).toEqual([lapsedLine]);
    expect(auditsOnDesk(covered)).toBe(0);
    expect(short.state.posting.resources.ore).toBe(0);
    expect(short.state.posting.crown.missed).toBe(1);
    expect(short.state.posting.crown.surcharge).toBeCloseTo(
      crownTuning.surcharge * uncovered,
      9,
    );
    expect(short.state.posting.crown.demand).toEqual(demand);
  });

  test("overflow pushes out the oldest ordinary entry and never an audit, even the oldest entry", () => {
    const game = indebted(100);
    game.state.posting.desk.nextArrivalTick = Number.MAX_SAFE_INTEGER;
    const audit = placeAudit(game);
    for (const id of [10, 11, 12]) {
      game.state.posting.desk.disputes.push({
        id,
        kind: "merchant",
        template: "smith",
        arrivedAt: game.state.tick,
      });
    }
    game.state.posting.desk.nextDisputeId = 13;

    game.desk.run(contextFor(game));
    const { disputes } = game.state.posting.desk;

    expect(disputes.map((entry) => entry.kind)).toEqual([
      "audit",
      "merchant",
      "merchant",
    ]);
    expect(disputes.map((entry) => entry.id)).toEqual([audit.id, 11, 12]);
    expect(game.desk.expired).toHaveLength(1);
  });
});
