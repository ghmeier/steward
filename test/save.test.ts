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
import {
  createNewGame,
  type GameState,
  SCHEMA_VERSION,
} from "../src/core/state";
import { loadTuning } from "../src/save/content";
import {
  loadGame,
  parseSave,
  readSaveFile,
  SAVE_FILE_NAME,
  SaveVersionError,
  saveGame,
  serializeSave,
} from "../src/save/save";

const meta = { savedAt: "2026-01-01T00:00:00.000Z", contentHash: "abc123" };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "steward-save-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function newState(seed = 42): GameState {
  return createNewGame(seed, loadTuning());
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
        join(import.meta.dir, "fixtures", "save-and-die.ts"),
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

describe("version refusal", () => {
  function writeOldSave(version: number): string {
    const text = `${JSON.stringify({ schemaVersion: version, savedAt: "x", contentHash: "y", state: {} })}\n`;
    writeFileSync(join(dir, "save.json"), text);
    return text;
  }

  test("refuses an older-version save by moving it to save.v<found>.json with its bytes intact", () => {
    const text = writeOldSave(7);

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
    writeOldSave(7);
    loadGame(dir);
    writeOldSave(7);

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
