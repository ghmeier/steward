import { describe, expect, test } from "bun:test";
import {
  contextFor,
  grantUnlocks,
  quietOptions,
  tuning,
} from "../../test/helpers";
import { stateHash } from "../save/hash";
import { apply } from "./commands";
import type { Condition } from "./decree";
import { enactDecree } from "./decree-engine";
import { type GameState, GameStateManager } from "./state";
import { step } from "./step";
import {
  ARCHIVE_PANEL,
  CHAINING_UNLOCK,
  COMPOUND_UNLOCK,
  CROWN_PANEL,
  hasUnlock,
  runUnlocks,
} from "./unlocks";
import { computeView } from "./view";

const entry = (id: string) => {
  const found = tuning.archive.entries.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no archive entry ${id}`);
  return found;
};
const palette = entry("control.palette");
const savedDecrees = entry("control.savedDecrees");

function richVillage(coin = 10_000): GameState {
  const m = new GameStateManager(1, tuning);
  m.state.tick = 7;
  m.state.posting.resources.coin = coin;
  grantUnlocks(m.state, [ARCHIVE_PANEL]);
  return m.state;
}

function buy(state: GameState, id: string) {
  return apply(state, { type: "buyUnlock", id }, tuning, contextFor(state));
}

describe("buyUnlock", () => {
  test("spends exactly the cost, down to zero coin, records the tick and unlocks dependents", () => {
    const state = richVillage(palette.cost + savedDecrees.cost);

    const first = buy(state, palette.id);
    const second = buy(state, savedDecrees.id);

    expect([first, second]).toEqual([{ ok: true }, { ok: true }]);
    expect(state.posting.resources.coin).toBe(0);
    expect(state.career.unlocks[palette.id]).toBe(7);
    expect(hasUnlock(state, savedDecrees.id)).toBe(true);
  });

  const owned = () => {
    const state = richVillage();
    buy(state, palette.id);
    return state;
  };
  const closed = () => {
    const state = richVillage();
    delete state.career.unlocks[ARCHIVE_PANEL];
    return state;
  };
  // biome-ignore format: one row per line keeps the table scannable
  const rejections: [string, () => GameState, string, string][] = [
    [
      "coin one short of the cost",
      () => richVillage(palette.cost - 1),
      palette.id,
      "costs",
    ],
    [
      "an id the Archive does not sell",
      richVillage,
      "control.nothing",
      "does not sell",
    ],
    ["an entry already owned", owned, palette.id, "already owned"],
    ["a play unlock", closed, ARCHIVE_PANEL, "only earned"],
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
      const state = setup();
      const before = stateHash(state);

      const result = buy(state, id);

      expect(result.ok).toBe(false);
      expect(result.ok ? "" : result.reason).toContain(reason);
      expect(stateHash(state)).toBe(before);
    },
  );
});

describe("decree gating", () => {
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
      const m = new GameStateManager(1, tuning);
      enactDecree(
        m.state,
        { id: "base", petition: "harvest", rules: [], otherwise: "sell" },
        tuning,
      );
      const decree = {
        id: "follower",
        petition: "labor",
        rules: [{ when, policy: "farming" }],
        otherwise: "balanced",
      };
      const before = stateHash(m.state);

      const rejected = enactDecree(m.state, decree, tuning);
      const unchanged = stateHash(m.state);
      grantUnlocks(m.state, [first]);
      const afterFirst = enactDecree(m.state, decree, tuning);
      grantUnlocks(m.state, [second]);
      const afterSecond = enactDecree(m.state, decree, tuning);

      expect(rejected.ok ? "" : rejected.reason).toContain(entry(first).label);
      expect(unchanged).toBe(before);
      if (first !== second) {
        expect(afterFirst.ok ? "" : afterFirst.reason).toContain(
          entry(second).label,
        );
      }
      expect(afterSecond).toEqual({ ok: true });
    },
  );
});

describe("play unlocks and need hooks", () => {
  test("each records the first tick its condition held and never changes it", () => {
    const m = new GameStateManager(1, tuning);
    const coinAt = (tick: number, coin: number) => {
      m.state.tick = tick;
      m.state.posting.resources.coin = coin;
      runUnlocks(m.state, tuning);
    };

    coinAt(3, 0);
    expect(hasUnlock(m.state, ARCHIVE_PANEL)).toBe(false);
    expect(m.state.career.needed).toEqual({});
    coinAt(4, 5);
    coinAt(5, 0);
    coinAt(6, 9);

    expect(m.state.career.unlocks[ARCHIVE_PANEL]).toBe(4);
    expect(m.state.career.needed.archive).toBe(4);
  });

  test("step runs unlocks, so the Archive opens on the step coin first exists", () => {
    const m = new GameStateManager(1, tuning);
    m.state.posting.resources.coin = 5;

    step(m.state, [], tuning, quietOptions);

    expect(m.state.career.unlocks[ARCHIVE_PANEL]).toBe(m.state.tick);
  });
});

describe("view", () => {
  test("archive entries follow data order with ownership, affordability and availability", () => {
    const state = richVillage(palette.cost);
    const before = computeView(state, tuning).archive.entries;
    buy(state, palette.id);
    state.posting.resources.coin = savedDecrees.cost;
    const locked = computeView(state, tuning).lockedPanels;
    grantUnlocks(state, [CROWN_PANEL]);

    const view = computeView(state, tuning);
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
