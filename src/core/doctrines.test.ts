import { describe, expect, test } from "bun:test";
import {
  contextFor,
  effectOf,
  grantUnlocks,
  revealArchive,
  setRoster,
  tuning,
} from "../../test/helpers";
import { AGRICULTURE, EXTRACTION, TRADE } from "./doctrine";
import { Game } from "./game";
import { NO_AUDIT_TICK } from "./illusion";
import { Job, type Resource } from "./realm";
import { ARCHIVE_PANEL, CROWN_PANEL, type ModifierId } from "./unlocks";

const { doctrines, prestige } = tuning;
const provinces = [...prestige.provinces.kind, ...prestige.provinces.harsh];
const doctrineEffect = (id: string, modifier: ModifierId) =>
  doctrines.entries.find((entry) => entry.id === id)?.effects[modifier];
const provinceEffect = (id: string, modifier: ModifierId) =>
  provinces.find((entry) => entry.id === id)?.effects[modifier];

/** A game partway through the career, set directly into the posting rather than reached by play. */
function posting(
  doctrine = "",
  province = "",
  index = doctrine === "" ? 1 : 2,
): Game {
  const game = Game.create(1, tuning);
  game.state.tick = 1;
  Object.assign(game.state.posting, { doctrine, province, index });
  grantUnlocks(game, [ARCHIVE_PANEL, CROWN_PANEL]);
  return game;
}

describe("modifiers", () => {
  test("Archive entries, the doctrine and the province multiply the same factor", () => {
    const game = posting(AGRICULTURE, "fertile-valley");
    grantUnlocks(game, ["tools.plough1"]);

    const farmYield = game.unlocks.modifier("farmYield");

    expect(farmYield).toBeCloseTo(
      effectOf("tools.plough1", "farmYield") *
        (doctrineEffect(AGRICULTURE, "farmYield") as number) *
        (provinceEffect("fertile-valley", "farmYield") as number),
    );
    expect(posting().unlocks.modifier("farmYield")).toBe(1);
  });

  test("Archive entries, the doctrine and the province add the same gap", () => {
    const game = posting(AGRICULTURE, "timber-march");
    grantUnlocks(game, ["store.granary1"]);

    expect(game.economy.capOf("grain")).toBe(
      tuning.economy.caps.grain +
        effectOf("store.granary1", "grainCap") +
        (doctrineEffect(AGRICULTURE, "grainCap") as number) +
        (provinceEffect("timber-march", "grainCap") as number),
    );
  });

  test("a modifier no source changes is left at its neutral value", () => {
    const game = posting(TRADE, "poor-soil");

    expect(game.unlocks.modifier("oreCap")).toBe(0);
    expect(game.unlocks.modifier("governorDeath")).toBe(1);
  });
});

describe("escalation", () => {
  const perPosting = prestige.escalationPerPosting;
  const kind = prestige.provinces.kind[0];
  const harsh = prestige.provinces.harsh[0];
  if (kind === undefined || harsh === undefined)
    throw new Error("no provinces");

  test.each([
    ["the first posting", 1, "", 1],
    [
      "a second posting in a province that adds nothing",
      2,
      kind.id,
      (1 + perPosting) * kind.escalation,
    ],
    [
      "a third posting in a harsh province",
      3,
      harsh.id,
      (1 + 2 * perPosting) * harsh.escalation,
    ],
  ])(
    "%s presses at the posting factor times the province factor",
    (_name, index, province, expected) => {
      const game = posting(TRADE, province, index);

      expect(game.prestige.escalation).toBeCloseTo(expected);
    },
  );

  test("the first demand of a later posting is its base amount times the escalation, and a first posting's is the base", () => {
    const later = posting(TRADE, harsh.id, 3);
    const first = posting();
    const issue = (game: Game) => {
      game.state.posting.crown.nextDemandTick = game.state.tick;
      game.crown.run(contextFor(game));
      return game.state.posting.crown.demand;
    };

    const laterDemand = issue(later);
    const firstDemand = issue(first);

    const base = (resource: string) =>
      tuning.crown.baseAmounts[resource as Resource];
    expect(laterDemand.amount).toBe(
      Math.round(base(laterDemand.resource) * later.prestige.escalation),
    );
    expect(firstDemand.amount).toBe(base(firstDemand.resource));
  });

  test("auditors come at a smaller debt in a harsher posting", () => {
    const threshold = (game: Game) =>
      tuning.illusion.audit.debtShare * game.illusion.ceiling;
    const announcedAt = (game: Game, debt: number) => {
      game.state.posting.illusion.debt.coin = debt;
      game.state.posting.illusion.debtSince = game.state.tick;
      game.state.tick += 1;
      game.illusion.run();
      return game.state.posting.illusion.auditAt !== NO_AUDIT_TICK;
    };
    const first = posting();
    const harsher = posting(TRADE, harsh.id, 3);
    const debt = threshold(first) / harsher.prestige.escalation;

    expect(announcedAt(first, debt)).toBe(false);
    expect(announcedAt(harsher, debt)).toBe(true);
    expect(announcedAt(posting(TRADE, harsh.id, 3), debt * 0.99)).toBe(false);
  });
});

describe("the trade rule: the crown accepts coin", () => {
  function demanding(game: Game, resource: Resource, amount: number): void {
    game.state.posting.crown.demand = {
      id: 1,
      resource,
      amount,
      delivered: 0,
      issuedAt: 1,
      dueAt: 5000,
    };
  }
  const payInCoin = (game: Game) =>
    game.commands.apply({ type: "payInCoin" }, contextFor(game));

  test("pays an open demand in coin at the sell price and counts it met", () => {
    const game = posting(TRADE);
    demanding(game, "ore", 80);
    game.state.posting.resources.coin = 1000;
    const price = game.economy.priceOf("ore");

    const result = payInCoin(game);

    expect(result.ok).toBe(true);
    expect(game.crown.isOpen).toBe(false);
    expect(game.state.posting.crown.met).toBe(1);
    const reward = tuning.crown.reward * 80;
    expect(game.state.posting.resources.coin).toBeCloseTo(
      1000 - 80 * price + reward,
    );
  });

  test("pays only what the coin covers and leaves the rest owing", () => {
    const game = posting(TRADE);
    demanding(game, "wood", 100);
    const price = game.economy.priceOf("wood");
    game.state.posting.resources.coin = 40 * price;

    payInCoin(game);

    expect(game.state.posting.crown.demand.delivered).toBeCloseTo(40);
    expect(game.state.posting.resources.coin).toBeCloseTo(0);
    expect(game.crown.isOpen).toBe(true);
  });

  test("is refused outside a trade posting, for a coin demand, and when no demand is open", () => {
    const farming = posting(AGRICULTURE);
    demanding(farming, "ore", 80);
    farming.state.posting.resources.coin = 1000;
    const coinDemand = posting(TRADE);
    demanding(coinDemand, "coin", 80);
    coinDemand.state.posting.resources.coin = 1000;
    const quiet = posting(TRADE);
    quiet.state.posting.resources.coin = 1000;

    const results = [farming, coinDemand, quiet].map(payInCoin);

    expect(results.map((result) => result.ok)).toEqual([false, false, false]);
    expect(farming.state.posting.resources.coin).toBe(1000);
    expect(farming.state.posting.crown.demand.delivered).toBe(0);
  });
});

describe("the agriculture rule: full granaries feed growth", () => {
  const farmers = 5;
  function harvesting(doctrine: string, grain: number): Game {
    const game = posting(doctrine);
    setRoster(game, { [Job.FARM]: farmers });
    game.state.posting.resources.grain = grain;
    return game;
  }
  const harvest = (game: Game) => {
    const before = game.state.posting.economy.growth;
    game.economy.run(contextFor(game));
    return game.state.posting.economy.growth - before;
  };

  test("harvest the full granary cannot hold goes toward the next peasant", () => {
    const game = harvesting(AGRICULTURE, tuning.economy.caps.grain + 125);
    const yielded =
      farmers * (game.economy.yieldPerWorker(Job.FARM, 1)?.amount ?? 0);
    const eaten = game.economy.grainUpkeepPerTick();

    const gained = harvest(game);

    expect(gained).toBeCloseTo(yielded - eaten);
  });

  test("a harvest that fits, or any other doctrine, adds nothing to growth", () => {
    const roomy = harvesting(AGRICULTURE, 100);
    const trading = harvesting(TRADE, tuning.economy.caps.grain);

    expect(harvest(roomy)).toBe(0);
    expect(harvest(trading)).toBe(0);
  });

  test("overflow that completes a peasant's progress admits the peasant", () => {
    const game = harvesting(AGRICULTURE, tuning.economy.caps.grain + 125);
    game.state.posting.economy.growth = tuning.economy.grainPerPeasant - 0.0001;
    const before = game.delegates.peasants.length;

    game.economy.run(contextFor(game));

    expect(game.delegates.peasants).toHaveLength(before + 1);
  });
});

describe("the extraction rule: prospecting", () => {
  const seasonEnd = tuning.economy.ticksPerSeason;
  function mining(doctrine: string, tick: number): Game {
    const game = posting(doctrine);
    game.state.tick = tick;
    setRoster(game, { [Job.MINE]: 3 });
    return game;
  }
  const coinOf = (game: Game) => game.state.posting.resources.coin ?? 0;

  test("the season's end pays the share of the ore mined, and the count starts over", () => {
    const game = mining(EXTRACTION, seasonEnd);
    game.state.posting.economy.seasonOre = 50;
    const dug =
      3 * (game.economy.yieldPerWorker(Job.MINE, seasonEnd)?.amount ?? 0);

    game.economy.run(contextFor(game));

    expect(coinOf(game)).toBeCloseTo((50 + dug) * doctrines.prospectingShare);
    expect(game.state.posting.economy.seasonOre).toBe(0);
  });

  test("ore is counted through the season but pays nothing before it ends", () => {
    const game = mining(EXTRACTION, seasonEnd - 1);

    game.economy.run(contextFor(game));

    expect(coinOf(game)).toBe(0);
    expect(game.state.posting.economy.seasonOre).toBeCloseTo(
      3 * (game.economy.yieldPerWorker(Job.MINE, seasonEnd - 1)?.amount ?? 0),
    );
  });

  test("other doctrines are paid nothing, though the count still restarts", () => {
    const game = mining(TRADE, seasonEnd);
    game.state.posting.economy.seasonOre = 50;

    game.economy.run(contextFor(game));

    expect(coinOf(game)).toBe(0);
    expect(game.state.posting.economy.seasonOre).toBe(0);
  });
});

describe("the first Archive purchase in a second posting", () => {
  const pairings = doctrines.entries.flatMap((doctrine) =>
    provinces.map((province): [string, string, string] => [
      `${doctrine.label} in ${province.label}`,
      doctrine.id,
      province.id,
    ]),
  );

  test.each(pairings)(
    "%s is affordable from the starting stores, which the stores can hold",
    (_name, doctrine, province) => {
      const game = posting(doctrine, province);
      Object.assign(game.state.posting.resources, prestige.resources);
      revealArchive(game);

      const affordable = game.unlocks
        .offered()
        .filter((entry) => game.unlocks.canBuy(entry));

      expect(affordable.length).toBeGreaterThan(0);
      for (const resource of ["grain", "wood", "ore"] as const) {
        expect(prestige.resources[resource]).toBeLessThanOrEqual(
          game.economy.capOf(resource),
        );
      }
    },
  );
});
