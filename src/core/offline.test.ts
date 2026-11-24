import { describe, expect, test } from "bun:test";
import {
  addGovernors,
  contextFor,
  governorOf,
  grantUnlocks,
  type RosterCounts,
  setRoster,
  tuning,
} from "../../test/helpers";
import { parseSave, serializeSave } from "../save/save";
import { copy } from "./copy";
import type { DeskEntry, ReturnReport } from "./desk";
import { Game } from "./game";
import { AGRICULTURE, EXTRACTION, TRADE } from "./prestige";
import { TRUE_REPORTS } from "./unlocks";

const { graceTicks } = tuning.offline;
const week = 7 * 24 * 60 * 60 * 10;
const hour = 60 * 60 * 10;
const winter = 2000;

function village(
  roster: RosterCounts,
  options: { tick?: number; doctrine?: string; grain?: number } = {},
): Game {
  const game = Game.create(1, tuning);
  game.state.tick = options.tick ?? 100;
  game.state.posting.doctrine = options.doctrine ?? AGRICULTURE;
  game.state.posting.desk.nextArrivalTick = 1e9;
  game.state.posting.resources.grain = options.grain ?? 60;
  setRoster(game, roster);
  return game;
}

describe("ticksAway", () => {
  test("counts whole ticks in a positive span and none in an empty, negative or unreadable one", () => {
    const { offline } = village({ idle: 1 });

    expect(offline.ticksAway(1050)).toBe(10);
    expect(offline.ticksAway(0)).toBe(0);
    expect(offline.ticksAway(-500)).toBe(0);
    expect(offline.ticksAway(Number.NaN)).toBe(0);
  });
});

describe("compress", () => {
  const { offline } = village({ idle: 1 });
  const hoursOf = (ticks: number) => ticks / hour;

  test("counts time inside the grace window in full", () => {
    expect(offline.compress(0)).toBe(0);
    expect(offline.compress(1234)).toBe(1234);
    expect(offline.compress(graceTicks)).toBe(graceTicks);
  });

  test("counts time past the grace window at a diminishing rate in whole ticks", () => {
    expect(hoursOf(offline.compress(hour))).toBeCloseTo(1.085, 2);
    expect(hoursOf(offline.compress(8 * hour))).toBeCloseTo(3.6, 1);
    expect(hoursOf(offline.compress(week))).toBeCloseTo(7.9, 1);
    expect(Number.isInteger(offline.compress(week + 1))).toBe(true);
  });
});

describe("catchUp", () => {
  test("a week away gains less than the rate times the real time, leaves the tick alone and never lowers debt", () => {
    const game = village({ farm: 2, forest: 6, idle: 2 });
    const { illusion } = game.state.posting;
    illusion.principal.coin = 100;
    illusion.debt.coin = 100;
    illusion.debtSince = 1;
    illusion.conjured.coin = 40;
    const rates = game.projection.flows().rates;
    const tickBefore = game.state.tick;

    const summary = game.offline.catchUp(week);

    expect(summary.gains.wood).toBeGreaterThan(0);
    expect(summary.gains.wood).toBeLessThan(rates.wood * week);
    expect(game.state.tick).toBe(tickBefore);
    expect(illusion.debt.coin).toBeGreaterThan(100);
    expect(summary.debtAdded).toBeGreaterThan(0);
    expect(illusion.conjured.coin).toBeLessThan(40);
    expect(summary.conjuredFaded).toBeGreaterThan(0);
  });

  test("no time away changes nothing", () => {
    const game = village({ farm: 4, idle: 4 });
    const before = structuredClone(game.state);

    const summary = game.offline.catchUp(0);

    expect(game.state).toEqual(before);
    expect(summary.compressedTicks).toBe(0);
  });

  test("a village left in winter still gains grain", () => {
    const game = village({ farm: 8, idle: 2 }, { tick: winter });
    const winterRate = game.projection.flows().rates.grain;

    const summary = game.offline.catchUp(week);

    expect(winterRate).toBeLessThan(0);
    expect(summary.gains.grain).toBeGreaterThan(0);
  });

  test("a granary fills to its cap and is reported full", () => {
    const game = village({ farm: 8, idle: 2 });

    const summary = game.offline.catchUp(week);

    expect(game.state.posting.resources.grain).toBe(
      game.economy.capOf("grain"),
    );
    expect(summary.fullStores).toContain("grain");
    expect(summary.fullStores).not.toContain("ore");
  });

  test("grain floors at zero and nobody starves when the village cannot feed itself", () => {
    const game = village({ idle: 10 }, { grain: 5 });
    const { starved } = game.state.posting.economy;

    game.offline.catchUp(week);

    expect(game.state.posting.resources.grain).toBe(0);
    expect(game.delegates.peasants).toHaveLength(10);
    expect(game.state.posting.economy.starved).toBe(starved);
  });

  test("feeding grain to growth stops short of a birth", () => {
    const game = village({ farm: 8, idle: 2 });
    game.decrees.enact({
      id: "harvest",
      petition: "harvest",
      rules: [],
      otherwise: "feed",
    });

    game.offline.catchUp(week);

    expect(game.state.posting.economy.growth).toBeGreaterThan(0);
    expect(game.state.posting.economy.growth).toBeLessThan(
      tuning.economy.grainPerPeasant,
    );
    expect(game.delegates.peasants).toHaveLength(10);
  });

  test("prospecting pays coin on the ore dug in an extraction posting, even with a full ore store, and nothing in a trade posting", () => {
    const empty = village({ mine: 8, idle: 2 }, { doctrine: EXTRACTION });
    const full = village({ mine: 8, idle: 2 }, { doctrine: EXTRACTION });
    full.state.posting.resources.ore = full.economy.capOf("ore");
    const trading = village({ mine: 8, idle: 2 }, { doctrine: TRADE });

    const emptyCoin = empty.offline.catchUp(hour).gains.coin;
    const fullCoin = full.offline.catchUp(hour).gains.coin;
    const tradedCoin = trading.offline.catchUp(hour).gains.coin;

    expect(emptyCoin).toBeGreaterThan(0);
    expect(fullCoin).toBeCloseTo(emptyCoin, 6);
    expect(tradedCoin).toBe(0);
  });
});

describe("return report", () => {
  const sellGrain = {
    id: "harvest",
    petition: "harvest",
    rules: [],
    otherwise: "sell",
  } as const;
  const laborOn = (policy: string) =>
    ({ id: "labor", petition: "labor", rules: [], otherwise: policy }) as const;

  const reportsOn = (game: Game): ReturnReport[] =>
    game.state.posting.desk.disputes.filter(
      (entry): entry is ReturnReport => entry.kind === "return",
    );

  /** What the report's first option charges in coin, which is the base amount times the report's scale. */
  function coinCost(game: Game): number {
    const [report] = game.desk.view().filter(({ kind }) => kind === "return");
    return 0 - (report?.options[0]?.resources.coin ?? 0);
  }

  function baseCoinCost(game: Game): number {
    const [report] = reportsOn(game);
    const option = game.desk.templateOf(report as ReturnReport).options[0];
    return -(option?.resources?.coin ?? 0);
  }

  function expectedScale(compressedTicks: number, signals: number) {
    const { returnScalePerHour, returnScaleMax } = tuning.offline;
    const hours = (compressedTicks * tuning.stepMs) / 3_600_000;
    return Math.min(returnScaleMax, signals * hours * returnScalePerHour);
  }

  function braggartVillage(trueReports: boolean): Game {
    const game = village({ farm: 2, forest: 6, idle: 2 });
    if (trueReports) grantUnlocks(game, [TRUE_REPORTS]);
    addGovernors(game, governorOf({ traits: ["braggart"] }));
    return game;
  }

  test("a week away with conjuring and debt gains less than the rate times the time, keeps the debt and leaves one report on the desk", () => {
    const game = village({ farm: 2, forest: 6, idle: 2 });
    const { illusion } = game.state.posting;
    illusion.principal.coin = 100;
    illusion.debt.coin = 100;
    illusion.debtSince = 1;
    illusion.conjured.coin = 40;
    game.decrees.enact(sellGrain);
    const rates = game.projection.flows().rates;

    const summary = game.offline.catchUp(week);

    expect(summary.gains.wood).toBeLessThan(rates.wood * week);
    expect(illusion.debt.coin).toBeGreaterThanOrEqual(100);
    expect(reportsOn(game)).toHaveLength(1);
  });

  test("no time away places no report", () => {
    const game = village({ farm: 4, idle: 4 });

    game.offline.catchUp(0);

    expect(reportsOn(game)).toHaveLength(0);
  });

  test("a village with no policy left running pays nothing to settle the report", () => {
    const game = village({ farm: 4, forest: 4 });
    game.decrees.enact(laborOn("balanced"));

    game.offline.catchUp(week);

    expect(baseCoinCost(game)).toBeGreaterThan(0);
    expect(coinCost(game)).toBe(0);
  });

  test("selling the harvest and a lopsided labor policy together cost more than either alone, scaled by the compressed time", () => {
    const food = village({ farm: 4, forest: 4 });
    food.decrees.enact(sellGrain);
    const labor = village({ farm: 4, forest: 4 });
    labor.decrees.enact(laborOn("farm"));
    const both = village({ farm: 4, forest: 4 });
    both.decrees.enact(sellGrain);
    both.decrees.enact(laborOn("farm"));

    food.offline.catchUp(week);
    labor.offline.catchUp(week);
    const { compressedTicks } = both.offline.catchUp(week);

    expect(coinCost(food)).toBeGreaterThan(0);
    expect(coinCost(both)).toBeGreaterThan(coinCost(food));
    expect(coinCost(labor)).toBe(coinCost(food));
    expect(coinCost(both)).toBe(
      Math.round(baseCoinCost(both) * expectedScale(compressedTicks, 2)),
    );
  });

  test("a custom labor split counts as lopsided only from the configured share", () => {
    const lopsided = village({ farm: 4, forest: 4 });
    lopsided.decrees.enact(laborOn("farm 80 forest 20"));
    const spread = village({ farm: 4, forest: 4 });
    spread.decrees.enact(laborOn("farm 79 forest 21"));

    lopsided.offline.catchUp(week);
    spread.offline.catchUp(week);

    expect(coinCost(lopsided)).toBeGreaterThan(0);
    expect(coinCost(spread)).toBe(0);
  });

  test("the scale stops at the configured maximum", () => {
    const capped = Game.create(1, {
      ...tuning,
      offline: { ...tuning.offline, returnScaleMax: 1 },
    });
    setRoster(capped, { farm: 4, forest: 4 });
    capped.decrees.enact(sellGrain);
    capped.decrees.enact(laborOn("farm"));

    capped.offline.catchUp(week);

    expect(reportsOn(capped)[0]?.scale).toBe(1);
  });

  test("a governor inflates the gains by their report factor and signs the report", () => {
    const game = braggartVillage(false);
    const [governor] = game.delegates.governors;
    if (governor === undefined) throw new Error("no governor");

    const summary = game.offline.catchUp(week);

    const [report] = reportsOn(game);
    expect(report?.reporter).toBe(governor.name);
    expect(report?.gains.wood).toBeCloseTo(
      summary.gains.wood * game.governors.reportFactorOf(governor),
      6,
    );
    expect(report?.gains.wood).toBeGreaterThan(summary.gains.wood);
  });

  test("a governor reports accurately once true reports are owned", () => {
    const game = braggartVillage(true);

    const summary = game.offline.catchUp(week);

    expect(reportsOn(game)[0]?.gains.wood).toBeCloseTo(summary.gains.wood, 6);
  });

  test("a clerk reports accurately when no governor serves", () => {
    const game = village({ farm: 2, forest: 6, idle: 2 });

    const summary = game.offline.catchUp(week);

    const [report] = reportsOn(game);
    expect(report?.reporter).toBe(copy.desk.clerk);
    expect(report?.gains.wood).toBeCloseTo(summary.gains.wood, 6);
  });

  test("a full desk keeps all its entries and the report, and none expires", () => {
    const game = village({ farm: 4, forest: 4 });
    const held: DeskEntry[] = [1, 2, 3].map((id) => ({
      id,
      kind: "merchant",
      template: "smith",
      arrivedAt: 0,
    }));
    game.state.posting.desk.disputes = held;
    game.state.posting.desk.nextDisputeId = 4;
    game.decrees.enact(sellGrain);

    game.offline.catchUp(week);
    game.desk.run(contextFor(game));

    expect(game.state.posting.desk.disputes.map((entry) => entry.kind)).toEqual(
      ["merchant", "merchant", "merchant", "return"],
    );
    expect(game.desk.expired).toHaveLength(0);
  });

  test("a second return replaces a report the player never answered", () => {
    const game = village({ farm: 4, forest: 4 });

    game.offline.catchUp(week);
    game.offline.catchUp(week);

    expect(reportsOn(game)).toHaveLength(1);
  });

  test("the report reads the same after a save round trip", () => {
    const game = village({ farm: 4, forest: 4 });
    game.decrees.enact(sellGrain);
    game.offline.catchUp(week);
    const before = game.desk.view();

    const saved = serializeSave(game.state, {
      savedAt: "2026-01-01T00:00:00.000Z",
      contentHash: "abc123",
    });
    const reloaded = Game.fromState(parseSave(saved).state, tuning);

    expect(reloaded.desk.view()).toEqual(before);
    expect(before.find(({ kind }) => kind === "return")?.label).toContain(
      "7 days",
    );
  });

  test("settling the report charges what it showed", () => {
    const game = village({ farm: 4, forest: 4 });
    game.state.posting.resources.coin = 500;
    game.decrees.enact(sellGrain);
    game.offline.catchUp(week);
    const cost = coinCost(game);
    const [report] = reportsOn(game);
    const coinBefore = game.state.posting.resources.coin;

    game.desk.settle(report?.id ?? 0, "pay-coin", contextFor(game));

    expect(cost).toBeGreaterThan(0);
    expect(game.state.posting.resources.coin).toBe(coinBefore - cost);
    expect(reportsOn(game)).toHaveLength(0);
  });
});
