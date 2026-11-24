import { describe, expect, test } from "bun:test";
import {
  contextFor,
  effectOf,
  grantUnlocks,
  openDemand,
  revealArchive,
  setRoster,
  tuning,
} from "../../test/helpers";
import { Game } from "./game";
import { NO_AUDIT_TICK } from "./illusion";
import { AGRICULTURE, EXTRACTION, TRADE } from "./prestige";
import { Job, type Resource } from "./realm";
import {
  ARCHIVE_PANEL,
  type ArchiveEffects,
  CROWN_PANEL,
  type ModifierId,
} from "./unlocks";

const { doctrines, prestige } = tuning;
type ProvinceEntry = (typeof prestige.provinces.kind)[number];
const provinces = [...prestige.provinces.kind, ...prestige.provinces.harsh];
const kind = prestige.provinces.kind[0] as ProvinceEntry;
const harsh = prestige.provinces.harsh[0] as ProvinceEntry;

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

function effect(
  effects: ArchiveEffects | undefined,
  modifier: ModifierId,
): number {
  const value = effects?.[modifier];
  if (value === undefined) throw new Error(`nothing changes ${modifier}`);
  return value;
}

describe("modifiers", () => {
  test("Archive entries, the doctrine and the province multiply factors and add gaps", () => {
    const mining = posting(EXTRACTION, "timber-march");
    grantUnlocks(mining, ["tools.axes1"]);
    const farming = posting(AGRICULTURE, "timber-march");
    grantUnlocks(farming, ["store.granary1"]);
    const { province } = mining.prestige;

    const forestYield = mining.unlocks.modifier("forestYield");
    const grainCap = farming.economy.capOf("grain");

    expect(forestYield).toBeCloseTo(
      effectOf("tools.axes1", "forestYield") *
        effect(mining.prestige.doctrine?.effects, "forestYield") *
        effect(province?.effects, "forestYield"),
    );
    expect(grainCap).toBe(
      tuning.economy.caps.grain +
        effectOf("store.granary1", "grainCap") +
        effect(farming.prestige.doctrine?.effects, "grainCap") +
        effect(province?.effects, "grainCap"),
    );
  });

  test("a modifier no source changes is left at its neutral value", () => {
    const game = posting(TRADE, "poor-soil");

    expect(game.unlocks.modifier("oreCap")).toBe(0);
    expect(game.unlocks.modifier("governorDeath")).toBe(1);
    expect(posting().unlocks.modifier("farmYield")).toBe(1);
  });
});

describe("escalation", () => {
  const perPosting = prestige.escalationPerPosting;

  test.each([
    ["the first posting", 1, "", 1],
    [
      "a second posting in a kind province",
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

  test("a later posting's first demand is its base amount times the escalation", () => {
    const game = posting(TRADE, harsh.id, 3);
    game.state.posting.crown.nextDemandTick = game.state.tick;

    game.crown.run(contextFor(game));

    const { demand } = game.state.posting.crown;
    const base = tuning.crown.baseAmounts[demand.resource as Resource];
    expect(demand.amount).toBe(Math.round(base * game.prestige.escalation));
  });

  test("auditors come at a smaller debt in a harsher posting", () => {
    const announcedAt = (game: Game, debt: number) => {
      game.state.posting.illusion.debt.coin = debt;
      game.state.posting.illusion.debtSince = game.state.tick;
      game.state.tick += 1;
      game.illusion.run();
      return game.state.posting.illusion.auditAt !== NO_AUDIT_TICK;
    };
    const first = posting();
    const harsher = posting(TRADE, harsh.id, 3);
    const debt =
      (tuning.illusion.audit.debtShare * first.illusion.ceiling) /
      harsher.prestige.escalation;

    expect(announcedAt(first, debt)).toBe(false);
    expect(announcedAt(harsher, debt)).toBe(true);
    expect(announcedAt(posting(TRADE, harsh.id, 3), debt * 0.99)).toBe(false);
  });
});

describe("the trade rule: the crown accepts coin", () => {
  const payInCoin = (game: Game) =>
    game.commands.apply({ type: "payInCoin" }, contextFor(game));

  test("pays an open demand in coin at the sell price and counts it met", () => {
    const game = posting(TRADE);
    openDemand(game, "ore", 80);
    game.state.posting.resources.coin = 1000;
    const price = game.economy.priceOf("ore");

    const result = payInCoin(game);

    expect(result.ok).toBe(true);
    expect(game.crown.isOpen).toBe(false);
    expect(game.state.posting.crown.met).toBe(1);
    expect(game.state.posting.resources.coin).toBeCloseTo(
      1000 - 80 * price + tuning.crown.reward * 80,
    );
  });

  test("pays only what the coin covers and leaves the rest owing", () => {
    const game = posting(TRADE);
    openDemand(game, "wood", 100);
    game.state.posting.resources.coin = 40 * game.economy.priceOf("wood");

    payInCoin(game);

    expect(game.state.posting.crown.demand.delivered).toBeCloseTo(40);
    expect(game.state.posting.resources.coin).toBeCloseTo(0);
    expect(game.crown.isOpen).toBe(true);
  });

  test("is refused outside a trade posting, for a coin demand, and when no demand is open", () => {
    const farming = posting(AGRICULTURE);
    openDemand(farming, "ore", 80);
    const coinDemand = posting(TRADE);
    openDemand(coinDemand, "coin", 80);
    const quiet = posting(TRADE);
    for (const game of [farming, coinDemand, quiet]) {
      game.state.posting.resources.coin = 1000;
    }

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

  test("harvest the full granary cannot hold goes toward the next peasant and can admit one", () => {
    const game = harvesting(AGRICULTURE, tuning.economy.caps.grain + 125);
    const { grainPerPeasant } = tuning.economy;
    game.state.posting.economy.growth = grainPerPeasant - 0.0001;
    const peasants = game.delegates.peasants.length;
    const yielded =
      farmers * (game.economy.yieldPerWorker(Job.FARM, 1)?.amount ?? 0);
    const overflow = yielded - game.economy.grainUpkeepPerTick();

    const gained = harvest(game);

    expect(gained).toBeCloseTo(overflow - grainPerPeasant);
    expect(game.delegates.peasants).toHaveLength(peasants + 1);
  });

  test("a harvest that fits, or any other doctrine, adds nothing to growth", () => {
    const roomy = harvesting(AGRICULTURE, 100);
    const trading = harvesting(TRADE, tuning.economy.caps.grain);

    expect(harvest(roomy)).toBe(0);
    expect(harvest(trading)).toBe(0);
  });
});

describe("the extraction rule: prospecting", () => {
  const seasonEnd = tuning.economy.ticksPerSeason;
  const miners = 3;
  function mining(doctrine: string, tick: number): Game {
    const game = posting(doctrine);
    game.state.tick = tick;
    setRoster(game, { [Job.MINE]: miners });
    game.state.posting.economy.seasonOre = 50;
    return game;
  }
  const dugAt = (game: Game) =>
    miners *
    (game.economy.yieldPerWorker(Job.MINE, game.state.tick)?.amount ?? 0);
  const coinOf = (game: Game) => game.state.posting.resources.coin ?? 0;

  test("the season's end pays the share of the ore mined, and the count starts over", () => {
    const game = mining(EXTRACTION, seasonEnd);
    const dug = dugAt(game);

    game.economy.run(contextFor(game));

    expect(coinOf(game)).toBeCloseTo((50 + dug) * doctrines.prospectingShare);
    expect(game.state.posting.economy.seasonOre).toBe(0);
  });

  test("nothing is paid before the season ends, and another doctrine neither counts nor pays", () => {
    const early = mining(EXTRACTION, seasonEnd - 1);
    const trading = mining(TRADE, seasonEnd);
    const dug = dugAt(early);

    early.economy.run(contextFor(early));
    trading.economy.run(contextFor(trading));

    expect(coinOf(early)).toBe(0);
    expect(early.state.posting.economy.seasonOre).toBeCloseTo(50 + dug);
    expect(coinOf(trading)).toBe(0);
    expect(trading.state.posting.economy.seasonOre).toBe(50);
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
