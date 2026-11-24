import { describe, expect, test } from "bun:test";
import {
  endPosting,
  grantUnlocks,
  quietOptions,
  revealArchive,
  servedVillage,
  tuning,
} from "../../test/helpers";
import { stateHash } from "../save/hash";
import { Game } from "./game";
import { derivePostingSeed, type Ending, TRADE } from "./prestige";
import { Job } from "./realm";

const { prestige } = tuning;
const provinceIds = (list: { id: string }[]) => list.map(({ id }) => id);
const harshProvinces = provinceIds(prestige.provinces.harsh);
const allProvinces = [
  ...provinceIds(prestige.provinces.kind),
  ...harshProvinces,
];

const doctrine = TRADE;

describe("endPosting", () => {
  test("is refused before the milestone or without a name, and allowed once the milestone is reached", () => {
    const early = servedVillage();
    early.state.posting.crown.met = prestige.demandsMet - 1;
    const unnamed = servedVillage();
    const ready = servedVillage();

    const refusedEarly = endPosting(early);
    const refusedUnnamed = endPosting(unnamed, "   ");
    const allowed = endPosting(ready);

    expect(refusedEarly?.ok).toBe(false);
    expect(early.state.posting.index).toBe(1);
    expect(early.state.career.postings).toEqual([]);
    expect(refusedUnnamed?.ok).toBe(false);
    expect(unnamed.state.posting.index).toBe(1);
    expect(allowed?.ok).toBe(true);
    expect(ready.state.posting.index).toBe(2);
    expect(() => ready.validate()).not.toThrow();
  });
});

describe("the doctrine", () => {
  const ids = tuning.doctrines.entries.map(({ id }) => id);

  test.each(["", "farming", "Trade"])(
    "endPosting is refused for the doctrine %p and leaves the posting as it was",
    (chosen) => {
      const game = servedVillage();

      const result = endPosting(game, "Greywater", chosen);

      expect(result?.ok).toBe(false);
      expect(game.state.posting.index).toBe(1);
      expect(game.state.career.postings).toEqual([]);
    },
  );

  test.each(ids)(
    "%s is recorded on the new posting, which stays valid",
    (id) => {
      const game = servedVillage();

      const result = endPosting(game, "Greywater", id);

      expect(result?.ok).toBe(true);
      expect(game.prestige.doctrine?.id).toBe(id);
      expect(() => game.validate()).not.toThrow();
    },
  );

  test("the closed posting's record keeps the doctrine it ran under, and the first posting has none", () => {
    const game = servedVillage();
    endPosting(game, "Greywater", ids[0] as string);
    game.state.posting.crown.met = prestige.demandsMet;

    endPosting(game, "Dunmere", ids[1] as string);

    expect(game.state.career.postings.map(({ doctrine }) => doctrine)).toEqual([
      "",
      ids[0] as string,
    ]);
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
        doctrine: "",
        startedAt: 0,
        endedAt: game.state.tick,
        ending: "promotion",
        favor: 30,
        demandsMet: prestige.demandsMet,
        demandsMissed: 0,
      },
    ]);
  });

  test("every ending sends the steward to a province the data names, and a scandal only to a harsh one", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const scandal = servedVillage(seed, -30);
      const others = [servedVillage(seed, 0), servedVillage(seed, 30)];

      for (const game of [scandal, ...others]) endPosting(game);

      expect(harshProvinces).toContain(scandal.state.posting.province);
      for (const game of others) {
        expect(allProvinces).toContain(game.state.posting.province);
      }
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
  test("starts at the tick it began with the data's stores and peasants, and schedules its first demand and dispute from there", () => {
    const game = servedVillage();
    game.state.posting.resources.coin = 9999;
    game.state.posting.illusion.debt = { coin: 40, grain: 0, ore: 0, wood: 0 };

    game.prestige.end("Dunmere", doctrine);

    const { posting, tick } = game.state;
    const { firstDemand } = tuning.crown;
    const demandWait = posting.crown.nextDemandTick - tick;
    expect(posting.name).toBe("Dunmere");
    expect(posting.startedAt).toBe(tick);
    expect(posting.resources).toEqual(prestige.resources);
    expect(game.delegates.peasants).toHaveLength(prestige.population);
    expect(posting.crown.met).toBe(0);
    expect(posting.crown.favor).toBe(0);
    expect(game.illusion.debtValue).toBe(0);
    expect(posting.decrees).toEqual({});
    expect(demandWait).toBeGreaterThanOrEqual(firstDemand.minTicks);
    expect(demandWait).toBeLessThanOrEqual(firstDemand.maxTicks);
    expect(posting.desk.nextArrivalTick).toBeGreaterThan(tick);
  });
});

describe("replay across postings", () => {
  test("the new posting's seed derives from the old one and from nothing else", () => {
    expect(derivePostingSeed(42, 2)).toBe(derivePostingSeed(42, 2));
    expect(derivePostingSeed(42, 2)).not.toBe(derivePostingSeed(42, 3));
    expect(derivePostingSeed(42, 2)).not.toBe(derivePostingSeed(43, 2));
  });

  test("a command log that ends the posting replays from the milestone to the same hash", () => {
    const start = servedVillage(7).state.tick;
    const log = [
      {
        tick: start + 5,
        command: { type: "endPosting", name: "Greywater", doctrine },
      },
      {
        tick: start + 20,
        command: { type: "assignPeasant", peasant: 1, job: Job.FARM },
      },
    ];
    const recorded = servedVillage(7);
    const replayed = servedVillage(7);
    const rejected: string[] = [];

    recorded.steps.runSteps(
      400,
      recorded.commands.parseCommandLog(log),
      quietOptions,
      (_tick, _commands, results) => {
        for (const result of results)
          if (!result.ok) rejected.push(result.reason);
      },
    );
    replayed.steps.runSteps(
      400,
      replayed.commands.parseCommandLog(JSON.parse(JSON.stringify(log))),
      quietOptions,
    );

    expect(rejected).toEqual([]);
    expect(recorded.state.posting.index).toBe(2);
    expect(recorded.state.posting.seed).toBe(derivePostingSeed(7, 2));
    expect(stateHash(replayed.state)).toBe(stateHash(recorded.state));
  });
});
