import { describe, expect, test } from "bun:test";
import {
  grantUnlocks,
  quietOptions,
  revealArchive,
  tuning,
} from "../../test/helpers";
import { stateHash } from "../save/hash";
import { Game } from "./game";
import { derivePostingSeed, type Ending } from "./prestige";
import { CROWN_PANEL } from "./unlocks";

const { prestige } = tuning;
const provinceIds = (list: { id: string }[]) => list.map(({ id }) => id);
const harshProvinces = provinceIds(prestige.provinces.harsh);
const allProvinces = [
  ...provinceIds(prestige.provinces.kind),
  ...harshProvinces,
];

/** A village that holds the charter and has met enough demands to ask for a new posting. */
function servedVillage(seed = 1, favor = 0): Game {
  const game = Game.create(seed, tuning);
  game.state.tick = 5000;
  grantUnlocks(game, [CROWN_PANEL]);
  game.state.posting.crown.met = prestige.demandsMet;
  game.state.posting.crown.favor = favor;
  return game;
}

function endPosting(game: Game, name = "Greywater") {
  const [result] = game.steps.step(
    [{ type: "endPosting", name }],
    quietOptions,
  );
  return result;
}

describe("endPosting", () => {
  test("is refused before the milestone and leaves the posting as it was", () => {
    const game = servedVillage();
    game.state.posting.crown.met = prestige.demandsMet - 1;

    const result = endPosting(game);

    expect(result?.ok).toBe(false);
    expect(game.state.posting.index).toBe(1);
    expect(game.state.career.postings).toEqual([]);
  });

  test("is allowed once the milestone is reached", () => {
    const game = servedVillage();

    const result = endPosting(game);

    expect(result?.ok).toBe(true);
    expect(game.state.posting.index).toBe(2);
    expect(() => game.validate()).not.toThrow();
  });

  test("is refused without a name", () => {
    const game = servedVillage();

    const result = endPosting(game, "   ");

    expect(result?.ok).toBe(false);
    expect(game.state.posting.index).toBe(1);
  });
});

describe("the ending", () => {
  test.each<[string, number, Ending]>([
    ["warm favor is a promotion", 30, "promotion"],
    ["neutral favor is a reassignment", 0, "reassignment"],
    ["cold favor is a scandal", -30, "scandal"],
  ])("%s", (_name, favor, ending) => {
    const game = servedVillage(1, favor);

    endPosting(game);

    expect(game.state.career.postings[0]?.ending).toBe(ending);
  });

  test("the career remembers the posting it closed", () => {
    const game = servedVillage(1, 30);
    const closed = game.state.posting;

    endPosting(game);

    expect(game.state.career.postings).toEqual([
      {
        index: 1,
        name: closed.name,
        province: "",
        startedAt: 0,
        endedAt: game.state.tick,
        ending: "promotion",
        favor: 30,
        demandsMet: prestige.demandsMet,
        demandsMissed: 0,
      },
    ]);
  });

  test("a scandal always sends the steward to a harsh province", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const game = servedVillage(seed, -30);

      endPosting(game);

      expect(harshProvinces).toContain(game.state.posting.province);
    }
  });

  test("every ending sends the steward to a province the data names", () => {
    for (const favor of [-30, 0, 30]) {
      const game = servedVillage(1, favor);

      endPosting(game);

      expect(allProvinces).toContain(game.state.posting.province);
    }
  });
});

describe("what carries over", () => {
  const entries = tuning.archive.entries;

  test("career entries, what has been seen, saved decrees and the promotion tick stay", () => {
    const game = servedVillage();
    grantUnlocks(
      game,
      entries.map(({ id }) => id),
    );
    revealArchive(game);
    game.state.career.promotedAt = 100;
    game.state.career.savedDecrees.keep = {
      id: "keep",
      petition: "ore",
      rules: [],
      otherwise: "sell",
    };
    const seen = { ...game.state.career.seen };

    endPosting(game);

    const owned = Object.keys(game.state.career.unlocks);
    for (const entry of entries.filter(({ scope }) => scope !== "posting")) {
      expect(owned).toContain(entry.id);
    }
    expect(game.state.career.seen).toEqual(seen);
    expect(Object.keys(game.state.career.savedDecrees)).toEqual(["keep"]);
    expect(game.state.career.promotedAt).toBe(100);
  });

  test("posting entries are dropped and are offered again for the same price once their prerequisites are owned", () => {
    const game = servedVillage();
    grantUnlocks(
      game,
      entries.map(({ id }) => id),
    );
    revealArchive(game);

    endPosting(game);

    const owned = Object.keys(game.state.career.unlocks);
    const reset = entries.filter(({ scope }) => scope === "posting");
    expect(reset.length).toBeGreaterThan(0);
    for (const entry of reset) expect(owned).not.toContain(entry.id);
    const offered = game.unlocks.offered().map(({ id }) => id);
    expect(offered).toContain("store.granary1");
    expect(offered).not.toContain("store.granary2");
  });
});

describe("the new posting", () => {
  test("starts with the stores and peasants the data names, at the tick it began", () => {
    const game = servedVillage();
    game.state.posting.resources.coin = 9999;
    game.state.posting.illusion.debt = { coin: 40, grain: 0, ore: 0, wood: 0 };

    game.prestige.end("Dunmere");

    const { posting, tick } = game.state;
    expect(posting.name).toBe("Dunmere");
    expect(posting.startedAt).toBe(tick);
    expect(posting.resources).toEqual(prestige.resources);
    expect(game.delegates.peasants).toHaveLength(prestige.population);
    expect(posting.crown.met).toBe(0);
    expect(posting.crown.favor).toBe(0);
    expect(game.illusion.debtValue).toBe(0);
    expect(posting.decrees).toEqual({});
  });

  test("the first crown demand is scheduled from the posting's start, within the usual range", () => {
    const game = servedVillage();

    endPosting(game);

    const { firstDemand } = tuning.crown;
    const wait = game.state.posting.crown.nextDemandTick - game.state.tick;
    expect(wait).toBeGreaterThanOrEqual(firstDemand.minTicks);
    expect(wait).toBeLessThanOrEqual(firstDemand.maxTicks);
  });

  test("the first dispute arrives after the posting began, not at an earlier tick", () => {
    const game = servedVillage();

    endPosting(game);

    expect(game.state.posting.desk.nextArrivalTick).toBeGreaterThan(
      game.state.tick,
    );
  });
});

describe("seed derivation", () => {
  test("the same previous seed and posting number always give the same seed, and a different number gives another", () => {
    expect(derivePostingSeed(42, 2)).toBe(derivePostingSeed(42, 2));
    expect(derivePostingSeed(42, 2)).not.toBe(derivePostingSeed(42, 3));
    expect(derivePostingSeed(42, 2)).not.toBe(derivePostingSeed(43, 2));
  });

  test("the new posting is seeded from the old one, so two identical games end in identical states", () => {
    const first = servedVillage(7);
    const second = servedVillage(7);

    endPosting(first);
    endPosting(second);

    expect(first.state.posting.seed).toBe(derivePostingSeed(7, 2));
    expect(stateHash(second.state)).toBe(stateHash(first.state));
  });
});
