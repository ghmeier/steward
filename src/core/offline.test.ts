import { describe, expect, test } from "bun:test";
import { type RosterCounts, setRoster, tuning } from "../../test/helpers";
import { Game } from "./game";
import { AGRICULTURE, EXTRACTION, TRADE } from "./prestige";

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

function feedHarvest(game: Game): void {
  game.decrees.enact({
    id: "harvest",
    petition: "harvest",
    rules: [],
    otherwise: "feed",
  });
}

describe("compress", () => {
  const { offline } = village({ idle: 1 });
  const hoursOf = (ticks: number) => ticks / hour;

  test("counts nothing for no time or negative time", () => {
    expect(offline.compress(0)).toBe(0);
    expect(offline.compress(-500)).toBe(0);
  });

  test("counts time inside the grace window in full", () => {
    expect(offline.compress(graceTicks)).toBe(graceTicks);
    expect(offline.compress(1234)).toBe(1234);
  });

  test("counts time past the grace window at a diminishing rate", () => {
    expect(hoursOf(offline.compress(hour))).toBeCloseTo(1.085, 2);
    expect(hoursOf(offline.compress(8 * hour))).toBeCloseTo(3.6, 1);
    expect(hoursOf(offline.compress(week))).toBeCloseTo(7.9, 1);
  });

  test("returns a whole number of ticks", () => {
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
    feedHarvest(game);

    game.offline.catchUp(week);

    expect(game.state.posting.economy.growth).toBeGreaterThan(0);
    expect(game.state.posting.economy.growth).toBeLessThan(
      tuning.economy.grainPerPeasant,
    );
    expect(game.delegates.peasants).toHaveLength(10);
  });

  test("prospecting pays coin in an extraction posting only", () => {
    const mining = village({ mine: 8, idle: 2 }, { doctrine: EXTRACTION });
    const trading = village({ mine: 8, idle: 2 }, { doctrine: TRADE });

    const mined = mining.offline.catchUp(hour);
    const traded = trading.offline.catchUp(hour);

    expect(mined.gains.coin).toBeGreaterThan(0);
    expect(traded.gains.coin).toBe(0);
  });
});
