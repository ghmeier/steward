import { describe, expect, test } from "bun:test";
import { contextFor, grantUnlocks, tuning } from "../../test/helpers";
import { stateHash } from "../save/hash";
import { parseSave, serializeSave } from "../save/save";
import { apply, type CommandResult } from "./commands";
import type { Condition } from "./decree";
import { enactDecree, repealDecree } from "./decree-engine";
import { enactSaved, forgetSaved, saveDecree } from "./saved-decrees";
import { createNewGame, type GameState } from "./state";
import {
  CHAINING_UNLOCK,
  COMPOUND_UNLOCK,
  SAVED_DECREES_UNLOCK as SAVED,
} from "./unlocks";
import { computeView } from "./view";

function labelOf(id: string): string {
  const found = tuning.archive.entries.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`no archive entry ${id}`);
  return found.label;
}

function village(unlocks: string[] = [SAVED]): GameState {
  const state = createNewGame(1, tuning);
  grantUnlocks(state, unlocks);
  return state;
}

function harvest(id: string, policy = "feed", when?: Condition) {
  return {
    id,
    petition: "harvest",
    rules: [{ when: when ?? { kind: "season", season: "winter" }, policy }],
    otherwise: "stockpile",
  };
}

const compoundWhen: Condition = {
  kind: "not",
  condition: { kind: "season", season: "winter" },
};

function chainedLabor(target: string) {
  return {
    id: "x",
    petition: "labor",
    rules: [
      {
        when: { kind: "chose", decree: target, policy: "feed" },
        policy: "farm",
      },
    ],
    otherwise: "balanced",
  };
}

function expectRejected(
  state: GameState,
  run: () => CommandResult,
  reasonPart: string,
) {
  const before = stateHash(state);

  const result = run();

  expect(result.ok).toBe(false);
  expect(result.ok ? "" : result.reason).toContain(reasonPart);
  expect(stateHash(state)).toBe(before);
}

describe("saveDecree", () => {
  test("stores the decree under the name, as its id, and replaces a saved name", () => {
    const state = village();

    const result = saveDecree(state, "plan", harvest("ignored"), tuning);
    saveDecree(state, "plan", harvest("x", "sell"), tuning);

    expect(result).toEqual({ ok: true });
    expect(state.career.savedDecrees.plan?.id).toBe("plan");
    expect(state.career.savedDecrees.plan?.rules[0]?.policy).toBe("sell");

    grantUnlocks(state, [COMPOUND_UNLOCK]);
    const compound = saveDecree(
      state,
      "plan",
      harvest("x", "feed", compoundWhen),
      tuning,
    );

    expect(compound).toEqual({ ok: true });
  });

  test("refuses a new name at the cap but still replaces an existing one", () => {
    const state = village();
    const cap = tuning.archive.maxSaved;
    for (let index = 0; index < cap; index++) {
      const name = `d${String.fromCharCode(97 + index)}`;
      saveDecree(state, name, harvest("x"), tuning);
    }

    expectRejected(
      state,
      () => saveDecree(state, "extra", harvest("x"), tuning),
      String(cap),
    );
    const replaced = saveDecree(state, "da", harvest("x", "sell"), tuning);

    expect(replaced).toEqual({ ok: true });
    expect(Object.keys(state.career.savedDecrees)).toHaveLength(cap);
  });

  // biome-ignore format: one row per line keeps the table scannable
  const rejections: [string, string[], string, object, string][] = [
		["no Archive entry", [], "plan", harvest("plan"), labelOf(SAVED)],
		["an invalid name", [SAVED], "Bad Name", harvest("x"), "not a valid decree name"],
		["a policy from another petition", [SAVED], "plan", harvest("plan", "farm"), "is not a harvest policy"],
		["a compound condition without compound conditions owned", [SAVED], "plan", harvest("plan", "feed", compoundWhen), labelOf(COMPOUND_UNLOCK)],
	];

  test.each(rejections)(
    "is rejected for %s and leaves the state unchanged",
    (_name, unlocks, name, decree, reason) => {
      const state = village(unlocks);

      expectRejected(
        state,
        () => saveDecree(state, name, decree, tuning),
        reason,
      );
    },
  );
});

describe("enactSaved", () => {
  test("takes over the active decree for the petition, keeping its id", () => {
    const state = village();
    enactDecree(state, harvest("granary"), tuning);
    saveDecree(state, "plan", harvest("x", "sell"), tuning);

    const result = enactSaved(state, "plan", tuning);

    expect(result).toEqual({ ok: true });
    expect(Object.keys(state.posting.decrees)).toEqual(["granary"]);
    expect(state.posting.decrees.granary?.rules[0]?.policy).toBe("sell");
  });

  test("uses the petition name as the id when no decree is active for it", () => {
    const state = village();
    saveDecree(state, "plan", harvest("x"), tuning);

    enactSaved(state, "plan", tuning);

    expect(Object.keys(state.posting.decrees)).toEqual(["harvest"]);
  });

  test("fails with the enact reason when a saved chain's target is no longer in force", () => {
    const state = village([CHAINING_UNLOCK, SAVED]);
    enactDecree(state, harvest("base"), tuning);
    saveDecree(state, "follow", chainedLabor("base"), tuning);
    repealDecree(state, "base");

    expectRejected(
      state,
      () => enactSaved(state, "follow", tuning),
      'references unknown decree "base"',
    );
  });

  test("is rejected without the Archive entry and for an unknown name", () => {
    const locked = village([]);
    const state = village();

    expectRejected(
      locked,
      () => enactSaved(locked, "plan", tuning),
      labelOf(SAVED),
    );
    expectRejected(state, () => enactSaved(state, "plan", tuning), "plan");
  });
});

describe("forgetSaved", () => {
  test("removes the named decree, even without the Archive entry, and rejects an unknown name", () => {
    const state = village();
    saveDecree(state, "plan", harvest("x"), tuning);
    delete state.career.unlocks[SAVED];

    const removed = forgetSaved(state, "plan");

    expect(removed).toEqual({ ok: true });
    expect(state.career.savedDecrees).toEqual({});
    expectRejected(state, () => forgetSaved(state, "plan"), "plan");
  });
});

describe("saved decrees elsewhere in the core", () => {
  test("survive a save and load round trip", () => {
    const state = village();
    saveDecree(state, "plan", harvest("x"), tuning);
    const meta = { savedAt: "2026-01-01T00:00:00.000Z", contentHash: "abc" };

    const loaded = parseSave(serializeSave(state, meta)).state;

    expect(loaded.career.savedDecrees).toEqual(state.career.savedDecrees);
  });

  test("the view lists saved decrees sorted by name", () => {
    const state = village();
    for (const name of ["zeta", "alpha", "mid"]) {
      saveDecree(state, name, harvest("x"), tuning);
    }

    const ids = computeView(state, tuning).savedDecrees.map((d) => d.id);

    expect(ids).toEqual(["alpha", "mid", "zeta"]);
  });

  test("apply routes save, enact and forget", () => {
    const state = village();
    const context = contextFor(state);
    const run = (command: Parameters<typeof apply>[1]) =>
      apply(state, command, tuning, context).ok;

    expect([
      run({ type: "saveDecree", name: "plan", decree: harvest("x") }),
      run({ type: "enactSaved", name: "plan" }),
      run({ type: "forgetSaved", name: "plan" }),
    ]).toEqual([true, true, true]);
  });
});
