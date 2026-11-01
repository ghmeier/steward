import { describe, expect, test } from "bun:test";
import {
  contextFor,
  grantUnlocks,
  quietOptions,
  tuning,
} from "../../test/helpers";
import { stateHash } from "../save/hash";
import type { Condition } from "./decree";
import { Game } from "./game";
import {
  ARCHIVE_PANEL,
  CHAINING_UNLOCK,
  COMPOUND_UNLOCK,
  CROWN_PANEL,
} from "./unlocks";

const entry = (id: string) => {
  const found = tuning.archive.entries.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no archive entry ${id}`);
  return found;
};
const palette = entry("control.palette");
const savedDecrees = entry("control.savedDecrees");

function richVillage(coin = 10_000): Game {
  const game = Game.create(1, tuning);
  game.state.tick = 7;
  game.state.posting.resources.coin = coin;
  grantUnlocks(game, [ARCHIVE_PANEL]);
  return game;
}

function buy(game: Game, id: string) {
  game.unlocks.buy(id, contextFor(game));
}

describe("buy", () => {
  test("spends exactly the cost, down to zero coin, records the tick and unlocks dependents", () => {
    const game = richVillage(palette.cost + savedDecrees.cost);

    buy(game, palette.id);
    buy(game, savedDecrees.id);

    expect(game.state.posting.resources.coin).toBe(0);
    expect(game.state.career.unlocks[palette.id]).toBe(7);
    expect(game.unlocks.enabled(savedDecrees.id)).toBe(true);
    expect(game.unlocks.purchased).toContain(palette.id);
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
  // biome-ignore format: one row per line keeps the table scannable
  const rejections: [string, () => Game, string, string][] = [
    [
      "coin one short of the cost",
      () => richVillage(palette.cost - 1),
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

describe("play unlocks and need hooks", () => {
  test("each records the first tick its condition held and never changes it", () => {
    const game = Game.create(1, tuning);
    const coinAt = (tick: number, coin: number) => {
      game.state.tick = tick;
      game.state.posting.resources.coin = coin;
      game.unlocks.run();
    };

    coinAt(3, 0);
    expect(game.unlocks.enabled(ARCHIVE_PANEL)).toBe(false);
    expect(game.state.career.needed).toEqual({});
    coinAt(4, 5);
    coinAt(5, 0);
    coinAt(6, 9);

    expect(game.state.career.unlocks[ARCHIVE_PANEL]).toBe(4);
    expect(game.state.career.needed.archive).toBe(4);
  });

  test("step runs unlocks, so the Archive opens on the step coin first exists", () => {
    const game = Game.create(1, tuning);
    game.state.posting.resources.coin = 5;

    game.steps.step([], quietOptions);

    expect(game.state.career.unlocks[ARCHIVE_PANEL]).toBe(game.state.tick);
  });
});

describe("view", () => {
  test("archive entries follow data order with ownership, affordability and availability", () => {
    const game = richVillage(palette.cost);
    const before = game.view.compute().archive.entries;
    buy(game, palette.id);
    game.state.posting.resources.coin = savedDecrees.cost;
    const locked = game.view.compute().lockedPanels;
    grantUnlocks(game, [CROWN_PANEL]);

    const view = game.view.compute();
    expect(locked).toEqual(["crown"]);
    expect(view.lockedPanels).toEqual([]);

    expect(view.archive.open).toBe(true);
    expect(view.archive.entries.map((e) => e.id)).toEqual(
      tuning.archive.entries.map((e) => e.id),
    );
    expect(before.find((e) => e.id === savedDecrees.id)?.available).toBe(false);
    expect(view.archive.entries[0]).toMatchObject({ owned: true });
    expect(view.archive.entries[1]).toMatchObject({
      owned: false,
      available: true,
      affordable: true,
    });
    expect(view.archive.entries[3]).toMatchObject({ affordable: false });
    expect(view.unlocks).toEqual(
      [ARCHIVE_PANEL, CROWN_PANEL, palette.id].sort(),
    );
  });
});
