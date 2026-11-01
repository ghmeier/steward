import { describe, expect, test } from "bun:test";
import { contextFor, grantUnlocks, tuning } from "../../test/helpers";
import { stateHash } from "../save/hash";
import { parseSave, serializeSave } from "../save/save";
import type { Command } from "./commands";
import type { Condition } from "./decree";
import { Game } from "./game";
import {
  CHAINING_UNLOCK,
  COMPOUND_UNLOCK,
  SAVED_DECREES_UNLOCK as SAVED,
} from "./unlocks";

function labelOf(id: string): string {
  const found = tuning.archive.entries.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`no archive entry ${id}`);
  return found.label;
}

function village(unlocks: string[] = [SAVED]): Game {
  const game = Game.create(1, tuning);
  grantUnlocks(game, unlocks);
  return game;
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

function expectRejected(game: Game, run: () => void, reasonPart: string) {
  const before = stateHash(game.state);

  expect(run).toThrow(reasonPart);
  expect(stateHash(game.state)).toBe(before);
}

describe("save", () => {
  test("stores the decree under the name, as its id, and replaces a saved name", () => {
    const game = village();
    const { savedDecrees } = game;
    const saved = game.state.career.savedDecrees;

    savedDecrees.save("plan", harvest("ignored"));
    savedDecrees.save("plan", harvest("x", "sell"));

    expect(saved.plan?.id).toBe("plan");
    expect(saved.plan?.rules[0]?.policy).toBe("sell");

    grantUnlocks(game, [COMPOUND_UNLOCK]);

    expect(() =>
      savedDecrees.save("plan", harvest("x", "feed", compoundWhen)),
    ).not.toThrow();
  });

  test("refuses a new name at the cap but still replaces an existing one", () => {
    const game = village();
    const cap = tuning.archive.maxSaved;
    for (let index = 0; index < cap; index++) {
      const name = `d${String.fromCharCode(97 + index)}`;
      game.savedDecrees.save(name, harvest("x"));
    }

    expectRejected(
      game,
      () => game.savedDecrees.save("extra", harvest("x")),
      String(cap),
    );
    expect(() =>
      game.savedDecrees.save("da", harvest("x", "sell")),
    ).not.toThrow();
    expect(Object.keys(game.state.career.savedDecrees)).toHaveLength(cap);
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
      const game = village(unlocks);

      expectRejected(game, () => game.savedDecrees.save(name, decree), reason);
    },
  );
});

describe("enact", () => {
  test("takes over the active decree for the petition, keeping its id", () => {
    const game = village();
    game.decrees.enact(harvest("granary"));
    game.savedDecrees.save("plan", harvest("x", "sell"));

    game.savedDecrees.enact("plan");

    expect(Object.keys(game.decrees.enacted)).toEqual(["granary"]);
    expect(game.decrees.enacted.granary?.rules[0]?.policy).toBe("sell");
  });

  test("uses the petition name as the id when no decree is active for it", () => {
    const game = village();
    game.savedDecrees.save("plan", harvest("x"));

    game.savedDecrees.enact("plan");

    expect(Object.keys(game.decrees.enacted)).toEqual(["harvest"]);
  });

  test("fails with the enact reason when a saved chain's target is no longer in force", () => {
    const game = village([CHAINING_UNLOCK, SAVED]);
    game.decrees.enact(harvest("base"));
    game.savedDecrees.save("follow", chainedLabor("base"));
    game.decrees.repeal("base");

    expectRejected(
      game,
      () => game.savedDecrees.enact("follow"),
      'references unknown decree "base"',
    );
  });

  test("is rejected without the Archive entry and for an unknown name", () => {
    const locked = village([]);
    const game = village();

    expectRejected(
      locked,
      () => locked.savedDecrees.enact("plan"),
      labelOf(SAVED),
    );
    expectRejected(game, () => game.savedDecrees.enact("plan"), "plan");
  });
});

describe("forget", () => {
  test("removes the named decree, even without the Archive entry, and rejects an unknown name", () => {
    const game = village();
    game.savedDecrees.save("plan", harvest("x"));
    delete game.state.career.unlocks[SAVED];

    game.savedDecrees.forget("plan");

    expect(game.state.career.savedDecrees).toEqual({});
    expectRejected(game, () => game.savedDecrees.forget("plan"), "plan");
  });
});

describe("saved decrees elsewhere in the core", () => {
  test("survive a save and load round trip", () => {
    const game = village();
    game.savedDecrees.save("plan", harvest("x"));
    const meta = { savedAt: "2026-01-01T00:00:00.000Z", contentHash: "abc" };

    const loaded = parseSave(serializeSave(game.state, meta)).state;

    expect(loaded.career.savedDecrees).toEqual(game.state.career.savedDecrees);
  });

  test("the view lists saved decrees sorted by name", () => {
    const game = village();
    for (const name of ["zeta", "alpha", "mid"]) {
      game.savedDecrees.save(name, harvest("x"));
    }

    const ids = game.view.compute().savedDecrees.map((decree) => decree.id);

    expect(ids).toEqual(["alpha", "mid", "zeta"]);
  });

  test("commands.apply routes save, enact and forget", () => {
    const game = village();
    const context = contextFor(game);
    const run = (command: Command) => game.commands.apply(command, context).ok;

    expect([
      run({ type: "saveDecree", name: "plan", decree: harvest("x") }),
      run({ type: "enactSaved", name: "plan" }),
      run({ type: "forgetSaved", name: "plan" }),
    ]).toEqual([true, true, true]);
  });
});
