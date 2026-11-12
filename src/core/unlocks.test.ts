import { describe, expect, test } from "bun:test";
import {
  contextFor,
  grantUnlocks,
  priceOf,
  quietOptions,
  revealArchive,
  setRoster,
  tuning,
} from "../../test/helpers";
import { stateHash } from "../save/hash";
import { NO_DEMAND_TICK } from "./crown";
import type { Condition } from "./decree";
import { Game } from "./game";
import {
  ARCHIVE_PANEL,
  CHAINING_UNLOCK,
  COMPOUND_UNLOCK,
  CONJURING,
  COURT_PANEL,
  CROWN_PANEL,
  DECREES_PANEL,
} from "./unlocks";

const entry = (id: string) => {
  const found = tuning.archive.entries.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no archive entry ${id}`);
  return found;
};
const palette = entry("control.palette");
const savedDecrees = entry("control.savedDecrees");
const charter = entry(CROWN_PANEL);
const court = entry(COURT_PANEL);

function richVillage(coin = 10_000): Game {
  const game = Game.create(1, tuning);
  game.state.tick = 7;
  game.state.posting.resources.coin = coin;
  grantUnlocks(game, [ARCHIVE_PANEL]);
  revealArchive(game);
  return game;
}

function buy(game: Game, id: string) {
  game.unlocks.buy(id, contextFor(game));
}

function stock(game: Game, resources: Record<string, number>): void {
  Object.assign(game.state.posting.resources, resources);
}

describe("buy", () => {
  test("spends exactly the cost, down to zero coin, records the tick and unlocks dependents", () => {
    const game = richVillage(priceOf(palette) + priceOf(savedDecrees));

    buy(game, palette.id);
    buy(game, savedDecrees.id);

    expect(game.state.posting.resources.coin).toBe(0);
    expect(game.state.career.unlocks[palette.id]).toBe(7);
    expect(game.unlocks.enabled(savedDecrees.id)).toBe(true);
    expect(game.unlocks.purchased).toContain(palette.id);
  });

  test("a mixed cost spends every resource it names and leaves the others alone", () => {
    const game = richVillage();
    stock(game, { coin: 250, wood: 130, ore: 9 });

    buy(game, charter.id);

    expect(game.state.posting.resources).toMatchObject({
      coin: 250 - priceOf(charter),
      wood: 130 - priceOf(charter, "wood"),
      ore: 9,
    });
    expect(game.unlocks.enabled(charter.id)).toBe(true);
  });

  test("a mixed cost is refused when one resource is short, and nothing is spent", () => {
    const game = richVillage();
    stock(game, { coin: 250, wood: priceOf(charter, "wood") - 1 });
    const before = stateHash(game.state);

    expect(() => buy(game, charter.id)).toThrow("not have enough wood");
    expect(stateHash(game.state)).toBe(before);
  });

  test("buying the charter schedules the first demand", () => {
    const game = richVillage();
    stock(game, { coin: 500, wood: 500 });
    const before = game.state.posting.crown.nextDemandTick;

    buy(game, charter.id);

    expect(before).toBe(NO_DEMAND_TICK);
    expect(game.state.posting.crown.nextDemandTick).toBeGreaterThanOrEqual(
      game.state.tick + tuning.crown.firstDemand.minTicks,
    );
  });

  const owned = () => {
    const game = richVillage();
    buy(game, palette.id);
    return game;
  };
  const closed = () => {
    const game = richVillage();
    delete game.state.career.unlocks[ARCHIVE_PANEL];
    return game;
  };
  const unrevealed = () => {
    const game = richVillage();
    delete game.state.career.seen[palette.id];
    return game;
  };
  // biome-ignore format: one row per line keeps the table scannable
  const rejections: [string, () => Game, string, string][] = [
    [
      "coin one short of the cost",
      () => richVillage(priceOf(palette) - 1),
      palette.id,
      "not have enough coin",
    ],
    [
      "an id the Archive does not sell",
      richVillage,
      "control.nothing",
      "does not sell",
    ],
    ["an entry already owned", owned, palette.id, "already own"],
    ["a play unlock", closed, ARCHIVE_PANEL, "not purchasable"],
    [
      "an entry whose prerequisite is missing",
      richVillage,
      savedDecrees.id,
      palette.label,
    ],
    [
      "a purchase while the Archive is closed",
      closed,
      palette.id,
      "the Archive is not open",
    ],
    [
      "an entry that has not been revealed",
      unrevealed,
      palette.id,
      "not offering",
    ],
  ];

  test.each(rejections)(
    "rejects %s and leaves the state unchanged",
    (_name, setup, id, reason) => {
      const game = setup();
      const before = stateHash(game.state);

      expect(() => buy(game, id)).toThrow(reason);
      expect(stateHash(game.state)).toBe(before);
    },
  );
});

describe("missingDecreeUnlock gating", () => {
  const winter: Condition = { kind: "season", season: "winter" };
  const rich: Condition = {
    kind: "compare",
    quantity: "coin",
    comparison: "above",
    value: 5,
  };
  const base = { kind: "chose", decree: "base", policy: "feed" } as const;
  // biome-ignore format: one row per line keeps the table scannable
  const rows: [string, Condition, string, string][] = [
    [
      "any",
      { kind: "any", conditions: [winter, rich] },
      COMPOUND_UNLOCK,
      COMPOUND_UNLOCK,
    ],
    [
      "all",
      { kind: "all", conditions: [winter, rich] },
      COMPOUND_UNLOCK,
      COMPOUND_UNLOCK,
    ],
    [
      "not",
      { kind: "not", condition: winter },
      COMPOUND_UNLOCK,
      COMPOUND_UNLOCK,
    ],
    ["chose", base, CHAINING_UNLOCK, CHAINING_UNLOCK],
    [
      "chose nested in all needs compound first, then chaining",
      { kind: "all", conditions: [base] },
      COMPOUND_UNLOCK,
      CHAINING_UNLOCK,
    ],
  ];

  test.each(rows)(
    "%s: rejected without the unlock, accepted once owned",
    (_name, when, first, second) => {
      const game = Game.create(1, tuning);
      game.decrees.enact({
        id: "base",
        petition: "harvest",
        rules: [],
        otherwise: "sell",
      });
      const decree = {
        id: "follower",
        petition: "labor",
        rules: [{ when, policy: "farming" }],
        otherwise: "balanced",
      };
      const before = stateHash(game.state);

      expect(() => game.decrees.enact(decree)).toThrow(entry(first).label);
      expect(stateHash(game.state)).toBe(before);

      grantUnlocks(game, [first]);
      if (first !== second) {
        expect(() => game.decrees.enact(decree)).toThrow(entry(second).label);
      }

      grantUnlocks(game, [second]);
      expect(() => game.decrees.enact(decree)).not.toThrow();
    },
  );
});

describe("play unlocks", () => {
  test("a play unlock records the first tick its condition held and never changes it", () => {
    const game = Game.create(1, tuning);
    const grainAt = (tick: number, grain: number) => {
      game.state.tick = tick;
      game.state.posting.resources.grain = grain;
      game.unlocks.run();
    };

    grainAt(3, 0);
    expect(game.unlocks.enabled(ARCHIVE_PANEL)).toBe(false);
    grainAt(4, 500);
    grainAt(5, 0);
    grainAt(6, 900);

    expect(game.state.career.unlocks[ARCHIVE_PANEL]).toBe(4);
  });

  test("step runs unlocks, so the Archive opens on the step grain first passes its threshold", () => {
    const game = Game.create(1, tuning);
    game.state.posting.resources.grain = 500;

    game.steps.step([], quietOptions);

    expect(game.state.career.unlocks[ARCHIVE_PANEL]).toBe(game.state.tick);
  });
});

describe("revealing entries", () => {
  const woodAt = (game: Game, tick: number, wood: number) => {
    game.state.tick = tick;
    game.state.posting.resources.wood = wood;
    game.unlocks.run();
  };

  test("an entry is revealed on the first tick its condition holds and stays revealed after the stock falls back", () => {
    const game = Game.create(1, tuning);

    woodAt(game, 2, 0);
    const before = game.unlocks.isSeen(DECREES_PANEL);
    woodAt(game, 3, 500);
    woodAt(game, 4, 0);

    expect(before).toBe(false);
    expect(game.state.career.seen[DECREES_PANEL]).toBe(3);
  });

  test("an entry with no condition is revealed at once", () => {
    const game = Game.create(1, tuning);

    game.unlocks.run();

    expect(game.unlocks.isSeen(entry(CONJURING).id)).toBe(true);
  });

  test("the charter is revealed by promotion and not by stock", () => {
    const game = Game.create(1, tuning);
    stock(game, { coin: 9999, wood: 9999 });
    game.unlocks.run();
    const beforePromotion = game.unlocks.isSeen(CROWN_PANEL);

    game.state.career.promotedAt = 5;
    game.state.tick = 5;
    game.unlocks.run();

    expect(beforePromotion).toBe(false);
    expect(game.unlocks.isSeen(CROWN_PANEL)).toBe(true);
  });

  test("promotion alone does not schedule a demand", () => {
    const game = Game.create(1, tuning);
    setRoster(game, { idle: tuning.village.promotionPopulation });

    game.steps.step([], quietOptions);

    expect(game.state.career.promotedAt).toBeGreaterThan(0);
    expect(game.state.posting.crown.nextDemandTick).toBe(NO_DEMAND_TICK);
    expect(game.unlocks.enabled(CROWN_PANEL)).toBe(false);
  });
});

describe("view", () => {
  test("every panel except the ledger and peasants is locked in a new village, and a panel opens once its unlock is owned", () => {
    const game = Game.create(1, tuning);
    const before = game.view.compute().lockedPanels;

    grantUnlocks(game, [COURT_PANEL]);

    expect(before.sort()).toEqual(["archive", "court", "crown", "decrees"]);
    expect(game.view.compute().lockedPanels).not.toContain("court");
  });

  test("owned and unrevealed entries are hidden from the archive", () => {
    const game = richVillage(priceOf(palette));
    delete game.state.career.seen[DECREES_PANEL];
    buy(game, palette.id);

    const ids = game.view.compute().archive.entries.map((e) => e.id);

    expect(ids).not.toContain(palette.id);
    expect(ids).not.toContain(DECREES_PANEL);
    expect(ids).toContain(court.id);
  });

  test("an entry whose prerequisite is missing is hidden until the prerequisite is owned", () => {
    const game = richVillage();
    const hidden = game.view.compute().archive.entries.map((e) => e.id);
    buy(game, palette.id);

    const shown = game.view.compute().archive.entries.map((e) => e.id);

    expect(hidden).not.toContain(savedDecrees.id);
    expect(shown).toContain(savedDecrees.id);
  });

  test("each cost part says whether it is covered, and the entry is affordable only when all are", () => {
    const game = richVillage(priceOf(charter));
    stock(game, { wood: 1 });

    const view = game.view
      .compute()
      .archive.entries.find((e) => e.id === charter.id);

    expect(view?.cost).toEqual([
      {
        resource: "coin",
        amount: priceOf(charter),
        held: priceOf(charter),
        affordable: true,
      },
      {
        resource: "wood",
        amount: priceOf(charter, "wood"),
        held: 1,
        affordable: false,
      },
    ]);
    expect(view?.affordable).toBe(false);
  });
});
