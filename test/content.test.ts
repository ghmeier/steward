import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contentHash, DEFAULT_DATA_DIR, loadTuning } from "../src/save/content";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "steward-content-"));
  writeFileSync(join(dir, "a.json"), "alpha");
  mkdirSync(join(dir, "sub"));
  writeFileSync(join(dir, "sub", "b.json"), "beta");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("contentHash", () => {
  test("is stable lowercase SHA-256 hex for unchanged files", () => {
    expect(contentHash(dir)).toBe(contentHash(dir));
    expect(contentHash(dir)).toMatch(/^[0-9a-f]{64}$/);
  });

  test("changes when one byte of a file changes", () => {
    const before = contentHash(dir);

    writeFileSync(join(dir, "sub", "b.json"), "betA");

    expect(contentHash(dir)).not.toBe(before);
  });

  test("changes when a file is renamed", () => {
    const before = contentHash(dir);

    renameSync(join(dir, "a.json"), join(dir, "c.json"));

    expect(contentHash(dir)).not.toBe(before);
  });

  test("changes when a file is added, even an empty one", () => {
    const before = contentHash(dir);

    writeFileSync(join(dir, "empty.json"), "");

    expect(contentHash(dir)).not.toBe(before);
  });

  test("changes when bytes move between files with the same concatenation", () => {
    const before = contentHash(dir);

    writeFileSync(join(dir, "a.json"), "alph");
    writeFileSync(join(dir, "sub", "b.json"), "abeta");

    expect(contentHash(dir)).not.toBe(before);
  });
});

describe("loadTuning", () => {
  test("reads and parses the real data directory", () => {
    const tuning = loadTuning();

    expect(DEFAULT_DATA_DIR.endsWith("data")).toBe(true);
    expect(tuning.stepMs).toBeGreaterThan(0);
    expect(tuning.economy.ticksPerSeason).toBeGreaterThan(0);
  });

  test("throws when tuning.json is missing", () => {
    expect(() => loadTuning(dir)).toThrow();
  });
});
