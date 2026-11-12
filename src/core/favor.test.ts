import { describe, expect, test } from "bun:test";
import {
  contextFor,
  grantUnlocks,
  quietOptions,
  setRoster,
  tuning,
} from "../../test/helpers";
import type { Command } from "./commands";
import type { FavorBand } from "./crown";
import { Game } from "./game";
import type { Resource } from "./realm";
import { CONJURING, CROWN_PANEL, FORGING } from "./unlocks";

const { crown: crownTuning, illusion: illusionTuning } = tuning;
const { favor: favorTuning } = crownTuning;
const { audit: auditTuning } = illusionTuning;

function village(favor = 0): Game {
  const game = Game.create(1, tuning);
  setRoster(game, { idle: tuning.village.promotionPopulation });
  grantUnlocks(game, [CONJURING, FORGING]);
  game.state.posting.crown.favor = favor;
  return game;
}

function favorOf(game: Game): number {
  return game.state.posting.crown.favor;
}

function stock(game: Game, resource: string, amount: number): void {
  game.state.posting.resources[resource] = amount;
}

function openDemand(game: Game, resource: Resource, amount: number): void {
  game.state.posting.crown.demand = {
    id: 1,
    resource,
    amount,
    delivered: 0,
    issuedAt: game.state.tick,
    dueAt: game.state.tick + crownTuning.deadline.minTicks,
  };
}

function command(game: Game, issued: Command) {
  game.state.tick += 1;
  return game.commands.apply(issued, contextFor(game));
}

function runToDeadline(game: Game): void {
  game.state.tick = game.state.posting.crown.demand.dueAt - 1;
  game.steps.runSteps(1, [], quietOptions);
}

function addAuditOnDesk(game: Game, debtInCoin: number): number {
  game.state.posting.illusion.debt.coin = debtInCoin;
  game.state.posting.illusion.debtSince = game.state.tick;
  game.desk.placeAudit(game.state.tick + auditTuning.deadlineTicks);
  const entry = game.state.posting.desk.disputes.at(-1);
  if (entry === undefined) throw new Error("no audit was placed");
  return entry.id;
}

function stepUntilDemand(game: Game): void {
  game.state.posting.crown.nextDemandTick = game.state.tick + 1;
  game.steps.runSteps(1, [], quietOptions);
}

describe("favor after a crown demand", () => {
  test("delivering in full early earns the met and early amounts, collection at the deadline only the met amount", () => {
    const early = village();
    openDemand(early, "ore", 50);
    stock(early, "ore", 50);
    const collected = village();
    openDemand(collected, "ore", 50);
    stock(collected, "ore", 50);

    command(early, { type: "deliver" });
    runToDeadline(collected);

    expect(favorOf(early)).toBe(favorTuning.met + favorTuning.early);
    expect(favorOf(collected)).toBe(favorTuning.met);
  });

  test("a partial delivery earns nothing until the demand is met, and a missed demand costs the missed amount", () => {
    const partial = village();
    openDemand(partial, "ore", 50);
    stock(partial, "ore", 20);
    const missed = village();
    openDemand(missed, "ore", 50);

    command(partial, { type: "deliver" });
    runToDeadline(missed);

    expect(favorOf(partial)).toBe(0);
    expect(favorOf(missed)).toBe(favorTuning.missed);
  });

  test("forging a report counts as meeting the demand early", () => {
    const game = village();
    openDemand(game, "grain", 40);

    command(game, { type: "forge" });

    expect(favorOf(game)).toBe(favorTuning.met + favorTuning.early);
  });
});

describe("favor after an audit", () => {
  test("backing earns its amount and deepening costs its amount", () => {
    const backed = village();
    stock(backed, "coin", 1000);
    const deepened = village();
    stock(deepened, "coin", 1000);

    const backedId = addAuditOnDesk(backed, 100);
    const deepenedId = addAuditOnDesk(deepened, 100);
    command(backed, {
      type: "settleDispute",
      dispute: backedId,
      option: "back",
    });
    command(deepened, {
      type: "settleDispute",
      dispute: deepenedId,
      option: "deepen",
    });

    expect(favorOf(backed)).toBe(favorTuning.backed);
    expect(favorOf(deepened)).toBe(favorTuning.deepened);
  });

  test("a debt cleared while auditors wait counts as backed", () => {
    const game = village();
    stock(game, "coin", 1000);
    addAuditOnDesk(game, 100);

    command(game, { type: "back", resource: "coin" });
    game.illusion.run();

    expect(favorOf(game)).toBe(favorTuning.backed);
  });

  test("a failed audit costs exactly the failed amount whether or not it leaves a shortfall", () => {
    const covered = village();
    stock(covered, "coin", 1000);
    const short = village();
    addAuditOnDesk(covered, 100);
    addAuditOnDesk(short, 100);

    covered.illusion.failAudit(contextFor(covered));
    short.illusion.failAudit(contextFor(short));

    expect(favorOf(covered)).toBe(favorTuning.failed);
    expect(favorOf(short)).toBe(favorTuning.failed);
    expect(covered.state.posting.crown.missed).toBe(0);
    expect(short.state.posting.crown.missed).toBe(1);
  });

  test("settling by kind answers the oldest entry of that kind, and is refused when none waits", () => {
    const game = village();
    stock(game, "coin", 1000);
    addAuditOnDesk(game, 100);
    const newest = addAuditOnDesk(game, 100);
    const settle: Command = { type: "settle", kind: "audit", option: "back" };

    const first = command(game, settle);
    const remaining = game.state.posting.desk.disputes.map((e) => e.id);
    const second = command(game, settle);
    const third = command(game, settle);

    expect(first).toEqual({ ok: true });
    expect(remaining).toEqual([newest]);
    expect(second).toEqual({ ok: true });
    expect(third.ok).toBe(false);
  });
});

describe("favor limits and bands", () => {
  test("the view reports the band word and nothing else about favor", () => {
    const game = village(favorTuning.warmAbove + 1);
    grantUnlocks(game, [CROWN_PANEL]);

    const { crown } = game.view.compute();

    expect(crown?.favor).toBe("warm");
    expect(JSON.stringify(crown)).not.toContain(String(favorOf(game)));
  });

  test("favor stops at the limit in both directions", () => {
    const high = village(favorTuning.limit - 1);
    openDemand(high, "ore", 50);
    stock(high, "ore", 50);
    const low = village(-favorTuning.limit + 1);
    openDemand(low, "ore", 50);

    command(high, { type: "deliver" });
    runToDeadline(low);

    expect(favorOf(high)).toBe(favorTuning.limit);
    expect(favorOf(low)).toBe(-favorTuning.limit);
  });

  test("the band is cold below the cold threshold, warm above the warm threshold and neutral on and between them", () => {
    const bandAt = (favor: number): FavorBand => village(favor).crown.band;

    expect(bandAt(favorTuning.coldBelow - 1)).toBe("cold");
    expect(bandAt(favorTuning.coldBelow)).toBe("neutral");
    expect(bandAt(0)).toBe("neutral");
    expect(bandAt(favorTuning.warmAbove)).toBe("neutral");
    expect(bandAt(favorTuning.warmAbove + 1)).toBe("warm");
  });

  test("a cold crown grows each demand faster than a neutral one", () => {
    const cold = village(favorTuning.coldBelow - 1);
    const neutral = village();
    const met = 3;
    cold.state.posting.crown.met = met;
    neutral.state.posting.crown.met = met;

    stepUntilDemand(cold);
    stepUntilDemand(neutral);

    for (const [game, factor] of [
      [cold, favorTuning.cold.stepFactor],
      [neutral, 1],
    ] as const) {
      const { demand } = game.state.posting.crown;
      const base = crownTuning.baseAmounts[demand.resource as Resource];
      expect(demand.amount).toBe(
        Math.round(base * (1 + crownTuning.step * factor * met)),
      );
    }
  });

  test("a cold crown audits a smaller debt sooner than a neutral one", () => {
    const cold = village(favorTuning.coldBelow - 1);
    const neutral = village();
    const debt =
      auditTuning.debtShare *
      favorTuning.cold.debtShareFactor *
      neutral.illusion.ceiling;
    for (const game of [cold, neutral]) {
      game.state.tick = 1;
      game.state.posting.illusion.debt.coin = debt;
      game.state.posting.illusion.debtSince = 1;
      game.illusion.run();
    }

    expect(cold.illusion.auditInTicks).toBe(
      Math.round(auditTuning.warningTicks * favorTuning.cold.warningFactor),
    );
    expect(neutral.illusion.auditInTicks).toBeNull();
  });

  test("a warm crown allows a higher ceiling and pays a larger reward for early delivery", () => {
    const warm = village(favorTuning.warmAbove + 1);
    const neutral = village();
    const amount = 50;
    for (const game of [warm, neutral]) {
      openDemand(game, "ore", amount);
      stock(game, "ore", amount);
      stock(game, "coin", 0);
      command(game, { type: "deliver" });
    }

    expect(warm.illusion.ceiling).toBeCloseTo(
      neutral.illusion.ceiling * favorTuning.warm.ceilingFactor,
    );
    expect(neutral.state.posting.resources.coin).toBeCloseTo(
      crownTuning.reward * amount,
    );
    expect(warm.state.posting.resources.coin).toBeCloseTo(
      crownTuning.reward * favorTuning.warm.rewardFactor * amount,
    );
  });
});

describe("the first forged quota", () => {
  test("repaid within a season, it never brings auditors", () => {
    const game = village();
    const demand = crownTuning.baseAmounts.grain;
    openDemand(game, "grain", demand);
    stock(game, "grain", 0);

    command(game, { type: "forge" });
    stock(game, "grain", demand * 2);
    game.steps.runSteps(tuning.economy.ticksPerSeason / 2, [], quietOptions);
    const warned = game.illusion.auditInTicks;
    command(game, { type: "back", resource: "grain" });

    expect(warned).toBeNull();
    expect(
      game.state.posting.desk.disputes.some((e) => e.kind === "audit"),
    ).toBe(false);
  });
});
