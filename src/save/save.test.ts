import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contextFor, setRoster } from "../../test/helpers";
import { emptyCrownState } from "../core/crown";
import { Game } from "../core/game";
import { emptyIllusionState } from "../core/illusion";
import { NO_LABOR_POLICY } from "../core/labor";
import { seedStream } from "../core/rng";
import { type GameState, SCHEMA_VERSION } from "../core/state";
import { CONJURING, CROWN_PANEL } from "../core/unlocks";
import { loadTuning } from "./content";
import {
  loadGame,
  parseSave,
  readSaveFile,
  SAVE_FILE_NAME,
  SaveVersionError,
  saveGame,
  serializeSave,
} from "./save";

const meta = { savedAt: "2026-01-01T00:00:00.000Z", contentHash: "abc123" };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "steward-save-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function newState(seed = 42): GameState {
  return Game.create(seed, loadTuning()).state;
}

function awkwardState(): GameState {
  const state = newState();
  state.tick = 7;
  state.posting.resources = {
    ...state.posting.resources,
    grain: 0.1 + 0.2,
    huge: 1e300,
    tiny: 5e-324,
  };
  return state;
}

function loaded(path: string): GameState {
  const result = loadGame(path);
  if (result.kind !== "loaded")
    throw new Error(`expected loaded, got ${result.kind}`);
  return result.save.state;
}

function writeSave(version: number, state: object = {}): string {
  const text = `${JSON.stringify({ schemaVersion: version, savedAt: "x", contentHash: "y", state })}\n`;
  writeFileSync(join(dir, "save.json"), text);
  return text;
}

describe("saveGame and loadGame", () => {
  test("round trip reproduces the file on disk byte for byte", () => {
    const state = awkwardState();

    const path = saveGame(dir, state, meta);
    const reloaded = loaded(dir);

    expect(path).toBe(join(dir, SAVE_FILE_NAME));
    expect(reloaded).toEqual(state);
    expect(serializeSave(reloaded, meta)).toBe(readFileSync(path, "utf8"));
    expect(reloaded.posting.resources.tiny).toBe(5e-324);
  });

  test("creates the save directory when it does not exist", () => {
    const nested = join(dir, "a", "b");

    saveGame(nested, newState(), meta);

    expect(loadGame(nested).kind).toBe("loaded");
  });

  test("defaults savedAt and contentHash when meta is omitted", () => {
    saveGame(dir, newState());
    const result = loadGame(dir);

    expect(result.kind).toBe("loaded");
    if (result.kind !== "loaded") return;
    expect(result.save.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(Number.isNaN(Date.parse(result.save.savedAt))).toBe(false);
  });

  test("a missing save reports missing", () => {
    expect(loadGame(dir)).toEqual({ kind: "missing" });
  });
});

describe("saveGame with an invalid state", () => {
  test.each([
    ["NaN", Number.NaN],
    ["negative zero", -0],
  ])(
    "throws on %s and leaves the existing save and directory untouched",
    (_name, bad) => {
      saveGame(dir, newState(1), meta);
      const before = readFileSync(join(dir, "save.json"), "utf8");
      const invalid = newState(2);
      invalid.posting.resources.grain = bad;

      expect(() => saveGame(dir, invalid, meta)).toThrow();

      expect(readFileSync(join(dir, "save.json"), "utf8")).toBe(before);
      expect(existsSync(join(dir, "save.json.tmp"))).toBe(false);
      expect(existsSync(join(dir, "save.json.bak"))).toBe(false);
    },
  );
});

describe("backup file", () => {
  test("each save moves the previous one to save.json.bak, replacing the older backup", () => {
    saveGame(dir, newState(1), meta);
    saveGame(dir, newState(2), meta);
    saveGame(dir, newState(3), meta);

    expect(loaded(dir)).toEqual(newState(3));
    expect(readSaveFile(join(dir, "save.json.bak")).state).toEqual(newState(2));
  });
});

describe("atomic write", () => {
  test("killing the writer after the temp write leaves the previous save loadable", () => {
    const original = newState(1);
    saveGame(dir, original, meta);
    const before = readFileSync(join(dir, "save.json"), "utf8");

    const child = Bun.spawnSync({
      cmd: [
        process.execPath,
        join(
          import.meta.dir,
          "..",
          "..",
          "test",
          "fixtures",
          "save-and-die.ts",
        ),
        dir,
        "2",
      ],
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(child.signalCode).toBe("SIGKILL");
    expect(readFileSync(join(dir, "save.json"), "utf8")).toBe(before);
    expect(loaded(dir)).toEqual(original);
  });
});

describe("version 8 upgrade", () => {
  test("a version 8 save loads as the current version and settles a labor decree on its first tick", () => {
    const state = newState() as unknown as Record<string, unknown>;
    const { labor: _, ...posting } = state.posting as Record<string, unknown>;
    writeSave(8, { ...state, schemaVersion: 8, posting });

    const game = Game.fromState(loaded(dir), loadTuning());

    expect(game.state.schemaVersion).toBe(SCHEMA_VERSION);
    expect(game.state.posting.labor).toEqual({
      policy: NO_LABOR_POLICY,
      settling: false,
    });
    expect(existsSync(join(dir, "save.v8.json"))).toBe(false);

    game.decrees.enact({
      id: "workforce",
      petition: "labor",
      rules: [],
      otherwise: "farm",
    });
    game.decrees.run(contextFor(game), { harvest: 0, wood: 0, ore: 0 });

    expect(game.state.posting.labor.policy).toBe("farm");
    expect(game.delegates.jobCounts().farm).toBe(1);
  });
});

describe("version 9 upgrade", () => {
  function version9Save(promotedAt: number): Record<string, unknown> {
    const state = newState() as unknown as Record<string, unknown>;
    const { crown: _, ...posting } = state.posting as Record<string, unknown>;
    const career = { ...(state.career as object), promotedAt };
    return { ...state, schemaVersion: 9, tick: 5000, career, posting };
  }

  test("a promoted version 9 save gains the Crown panel and a first demand one delay after the save's tick", () => {
    writeSave(9, version9Save(4000));

    const state = loaded(dir);

    expect(state.schemaVersion).toBe(SCHEMA_VERSION);
    expect(state.career.unlocks[CROWN_PANEL]).toBe(state.tick);
    expect(state.posting.crown.nextDemandTick).toBe(
      state.tick + loadTuning().crown.firstDemandTicks,
    );
    expect(state.posting.rng.crown).toEqual(
      seedStream(state.posting.seed, "crown"),
    );
  });

  test("an unpromoted version 9 save gains an empty crown and no panel", () => {
    writeSave(9, version9Save(0));

    const state = loaded(dir);

    expect(state.posting.crown).toEqual(emptyCrownState());
    expect(Object.hasOwn(state.career.unlocks, CROWN_PANEL)).toBe(false);
  });
});

describe("version 10 upgrade", () => {
  function version10Save(): Record<string, unknown> {
    const game = Game.create(42, loadTuning());
    setRoster(game, { idle: 2 });
    game.state.posting.desk.nextDisputeId = 3;
    game.state.posting.desk.disputes = [
      {
        id: 1,
        kind: "dispute",
        template: "stolen-hen",
        parties: [1, 2],
        arrivedAt: 0,
      },
      {
        id: 2,
        kind: "dispute",
        template: "dowry",
        parties: [2, 1],
        arrivedAt: 0,
      },
    ];
    const state = structuredClone(game.state) as unknown as Record<
      string,
      unknown
    >;
    const { desk } = state.posting as { desk: Record<string, unknown> };
    const entries = (desk.disputes as Record<string, unknown>[]).map(
      ({ kind: _, ...entry }) => entry,
    );
    return {
      ...state,
      schemaVersion: 10,
      posting: {
        ...(state.posting as object),
        desk: { ...desk, disputes: entries },
      },
    };
  }

  test("a version 10 save loads with every existing desk entry marked as a dispute", () => {
    writeSave(10, version10Save());

    const state = loaded(dir);

    expect(state.schemaVersion).toBe(SCHEMA_VERSION);
    expect(state.posting.desk.disputes.map((entry) => entry.kind)).toEqual([
      "dispute",
      "dispute",
    ]);
  });
});

describe("version 11 upgrade", () => {
  function version11Save(crown: Partial<GameState["posting"]["crown"]>) {
    const game = Game.create(42, loadTuning());
    game.state.tick = 5000;
    game.state.posting.crown = { ...emptyCrownState(), ...crown };
    const { illusion: _, ...posting } = structuredClone(game.state.posting);
    return {
      ...structuredClone(game.state),
      schemaVersion: 11,
      posting,
    };
  }

  const openDemand = {
    id: 1,
    resource: "grain",
    amount: 300,
    delivered: 0,
    issuedAt: 4000,
    dueAt: 5800,
  };

  test("a save with an open demand gets an empty illusion state and the conjuring unlock", () => {
    writeSave(11, version11Save({ demand: openDemand }));

    const state = loaded(dir);

    expect(state.schemaVersion).toBe(SCHEMA_VERSION);
    expect(state.posting.illusion).toEqual(emptyIllusionState());
    expect(Object.hasOwn(state.career.unlocks, CONJURING)).toBe(true);
  });

  test("a save whose demands have all been settled also gets the unlock", () => {
    writeSave(11, version11Save({ met: 1, missed: 1 }));

    const state = loaded(dir);

    expect(Object.hasOwn(state.career.unlocks, CONJURING)).toBe(true);
  });

  test("a save from before the crown's first demand gets the empty state without the unlock", () => {
    writeSave(11, version11Save({}));

    const state = loaded(dir);

    expect(state.posting.illusion).toEqual(emptyIllusionState());
    expect(Object.hasOwn(state.career.unlocks, CONJURING)).toBe(false);
  });
});

describe("version 12 upgrade", () => {
  test("a version 12 save loads with neutral favor and keeps its demand tally", () => {
    const game = Game.create(42, loadTuning());
    game.state.posting.crown = { ...emptyCrownState(), met: 3, missed: 1 };
    const state = structuredClone(game.state) as unknown as Record<
      string,
      unknown
    >;
    const posting = state.posting as { crown: Record<string, unknown> };
    const { favor: _, ...crown } = posting.crown;
    writeSave(12, {
      ...state,
      schemaVersion: 12,
      posting: { ...posting, crown },
    });

    const loadedState = loaded(dir);

    expect(loadedState.schemaVersion).toBe(SCHEMA_VERSION);
    expect(loadedState.posting.crown).toEqual({
      ...emptyCrownState(),
      met: 3,
      missed: 1,
      favor: 0,
    });
  });
});

describe("version refusal", () => {
  test("refuses an older-version save by moving it to save.v<found>.json with its bytes intact", () => {
    const text = writeSave(7);

    const result = loadGame(dir);

    expect(result).toEqual({
      kind: "versionRefused",
      foundVersion: 7,
      preservedAs: join(dir, "save.v7.json"),
    });
    expect(readFileSync(join(dir, "save.v7.json"), "utf8")).toBe(text);
    expect(existsSync(join(dir, "save.json"))).toBe(false);
  });

  test("a repeated refusal of the same version uses the next free numbered name", () => {
    writeSave(7);
    loadGame(dir);
    writeSave(7);

    const result = loadGame(dir);

    expect(result).toMatchObject({
      kind: "versionRefused",
      preservedAs: join(dir, "save.v7.1.json"),
    });
    expect(existsSync(join(dir, "save.v7.json"))).toBe(true);
  });

  test("parseSave throws SaveVersionError carrying the found version", () => {
    const text = JSON.stringify({ schemaVersion: 99 });

    expect(() => parseSave(text)).toThrow(SaveVersionError);
    try {
      parseSave(text);
    } catch (error) {
      expect((error as SaveVersionError).foundVersion).toBe(99);
    }
  });
});

describe("invalid saves", () => {
  test("corrupt JSON reports invalid and leaves the file untouched", () => {
    writeFileSync(join(dir, "save.json"), "{ not json");

    const result = loadGame(dir);

    expect(result.kind).toBe("invalid");
    expect(readFileSync(join(dir, "save.json"), "utf8")).toBe("{ not json");
  });

  test("a current-version save with a bad state reports invalid and is not renamed", () => {
    const text = `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, savedAt: "x", contentHash: "y", state: { tick: -1 } })}\n`;
    writeFileSync(join(dir, "save.json"), text);

    const result = loadGame(dir);

    expect(result.kind).toBe("invalid");
    expect(readFileSync(join(dir, "save.json"), "utf8")).toBe(text);
  });
});

describe("version 13 upgrade", () => {
  function version13Save(): Record<string, unknown> {
    const game = Game.create(42, loadTuning());
    setRoster(game, { idle: 2 });
    const state = structuredClone(game.state) as unknown as {
      posting: {
        formerStaff?: unknown;
        rng: Record<string, unknown>;
        delegates: Record<string, unknown>[];
      };
    };
    const { formerStaff: _, ...posting } = state.posting;
    const { governors: __, ...rng } = posting.rng;
    for (const delegate of posting.delegates) delete delegate.kind;
    return { ...state, schemaVersion: 13, posting: { ...posting, rng } };
  }

  test("a version 13 save gains empty former staff, its own governors stream and peasant kinds", () => {
    writeSave(13, version13Save());

    const state = loaded(dir);

    expect(state.schemaVersion).toBe(SCHEMA_VERSION);
    expect(state.posting.formerStaff).toEqual([]);
    expect(state.posting.rng.governors).toEqual(
      seedStream(state.posting.seed, "governors"),
    );
    expect(state.posting.delegates.map((delegate) => delegate.kind)).toEqual([
      "peasant",
      "peasant",
    ]);
  });
});
