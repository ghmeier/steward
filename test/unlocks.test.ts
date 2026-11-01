import { describe, expect, test } from "bun:test";
import { apply } from "../src/core/commands";
import type { Condition } from "../src/core/decree";
import { enactDecree } from "../src/core/decree-engine";
import { createNewGame, type GameState } from "../src/core/state";
import { step } from "../src/core/step";
import {
  ARCHIVE_PANEL,
  CHAINING_UNLOCK,
  COMPOUND_UNLOCK,
  CROWN_PANEL,
  hasUnlock,
  runUnlocks,
} from "../src/core/unlocks";
import { computeView } from "../src/core/view";
import { stateHash } from "../src/save/hash";
import { contextFor, grantUnlocks, quietOptions, tuning } from "./helpers";

const entry = (id: string) => {
  const found = tuning.archive.entries.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no archive entry ${id}`);
  return found;
};
const palette = entry("control.palette");
const savedDecrees = entry("control.savedDecrees");

function richVillage(coin = 10_000): GameState {
  const state = createNewGame(1, tuning);
  state.tick = 7;
  state.posting.resources.coin = coin;
  grantUnlocks(state, [ARCHIVE_PANEL]);
  return state;
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
		["coin one short of the cost", () => richVillage(palette.cost - 1), palette.id, "costs"],
		["an id the Archive does not sell", richVillage, "control.nothing", "does not sell"],
		["an entry already owned", owned, palette.id, "already owned"],
		["a play unlock", closed, ARCHIVE_PANEL, "only earned"],
		["an entry whose prerequisite is missing", richVillage, savedDecrees.id, palette.label],
		["a purchase while the Archive is closed", closed, palette.id, "the Archive is not open"],
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
		["any", { kind: "any", conditions: [winter, rich] }, COMPOUND_UNLOCK, COMPOUND_UNLOCK],
		["all", { kind: "all", conditions: [winter, rich] }, COMPOUND_UNLOCK, COMPOUND_UNLOCK],
		["not", { kind: "not", condition: winter }, COMPOUND_UNLOCK, COMPOUND_UNLOCK],
		["chose", base, CHAINING_UNLOCK, CHAINING_UNLOCK],
		["chose nested in all needs compound first, then chaining", { kind: "all", conditions: [base] }, COMPOUND_UNLOCK, CHAINING_UNLOCK],
	];

  test.each(rows)(
    "%s: rejected without the unlock, accepted once owned",
    (_name, when, first, second) => {
      const state = createNewGame(1, tuning);
      enactDecree(
        state,
        { id: "base", petition: "harvest", rules: [], otherwise: "sell" },
        tuning,
      );
      const decree = {
        id: "follower",
        petition: "labor",
        rules: [{ when, policy: "farming" }],
        otherwise: "balanced",
      };
      const before = stateHash(state);

      const rejected = enactDecree(state, decree, tuning);
      const unchanged = stateHash(state);
      grantUnlocks(state, [first]);
      const afterFirst = enactDecree(state, decree, tuning);
      grantUnlocks(state, [second]);
      const afterSecond = enactDecree(state, decree, tuning);

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
    const state = createNewGame(1, tuning);
    const coinAt = (tick: number, coin: number) => {
      state.tick = tick;
      state.posting.resources.coin = coin;
      runUnlocks(state, tuning);
    };

    coinAt(3, 0);
    expect(hasUnlock(state, ARCHIVE_PANEL)).toBe(false);
    expect(state.career.needed).toEqual({});
    coinAt(4, 5);
    coinAt(5, 0);
    coinAt(6, 9);

    expect(state.career.unlocks[ARCHIVE_PANEL]).toBe(4);
    expect(state.career.needed.archive).toBe(4);
  });

  test("step runs unlocks, so the Archive opens on the step coin first exists", () => {
    const state = createNewGame(1, tuning);
    state.posting.resources.coin = 5;

    step(state, [], tuning, quietOptions);

    expect(state.career.unlocks[ARCHIVE_PANEL]).toBe(state.tick);
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
