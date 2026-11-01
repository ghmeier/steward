import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..");
const commandLog = join(import.meta.dir, "fixtures", "command-log.json");

type Summary = { type: "summary"; tick: number; hash: string };

function runSimProcess(args: string[]): Summary {
  const result = Bun.spawnSync(["bun", "src/runner/sim.ts", ...args], {
    cwd: repoRoot,
  });
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
  const lines = result.stdout.toString().trim().split("\n");
  return JSON.parse(lines[lines.length - 1] as string) as Summary;
}

function withoutSavedAt(saveText: string): string {
  return saveText.replace(/^(\s*"savedAt": ).*$/m, '$1"normalized",');
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "steward-determinism-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("two separate processes", () => {
  test("same seed, command log and step count produce the same hash", () => {
    const args = ["--seed", "42", "--steps", "10000", "--commands", commandLog];

    const first = runSimProcess(args);
    const second = runSimProcess(args);

    expect(second.hash).toBe(first.hash);
    expect(first.tick).toBe(10000);
  });

  test("the command log and the seed both change the hash", () => {
    const withLog = runSimProcess([
      "--seed",
      "42",
      "--steps",
      "10000",
      "--commands",
      commandLog,
    ]);

    const withoutLog = runSimProcess(["--seed", "42", "--steps", "10000"]);
    const otherSeed = runSimProcess([
      "--seed",
      "43",
      "--steps",
      "10000",
      "--commands",
      commandLog,
    ]);

    expect(withoutLog.hash).not.toBe(withLog.hash);
    expect(otherSeed.hash).not.toBe(withLog.hash);
  });
});

describe("split run", () => {
  test("saving at 5,000 and resuming in a new process equals an uninterrupted run", () => {
    const savePath = join(dir, "a.json");
    runSimProcess([
      "--seed",
      "42",
      "--steps",
      "5000",
      "--commands",
      commandLog,
      "--out",
      savePath,
    ]);

    const resumed = runSimProcess([
      "--load",
      savePath,
      "--steps",
      "5000",
      "--commands",
      commandLog,
    ]);
    const uninterrupted = runSimProcess([
      "--seed",
      "42",
      "--steps",
      "10000",
      "--commands",
      commandLog,
    ]);

    expect(resumed.tick).toBe(10000);
    expect(resumed.hash).toBe(uninterrupted.hash);
  });
});

describe("round trip", () => {
  test("loading and re-saving reproduces the file except for savedAt", () => {
    const first = join(dir, "a.json");
    const second = join(dir, "b.json");
    runSimProcess([
      "--seed",
      "42",
      "--steps",
      "5000",
      "--commands",
      commandLog,
      "--out",
      first,
    ]);

    runSimProcess(["--load", first, "--steps", "0", "--out", second]);

    const firstText = readFileSync(first, "utf8");
    const secondText = readFileSync(second, "utf8");
    expect(firstText).toContain('"savedAt"');
    expect(withoutSavedAt(secondText)).toBe(withoutSavedAt(firstText));
    expect(secondText).toContain(
      (JSON.parse(firstText) as { contentHash: string }).contentHash,
    );
  });
});

describe("replay", () => {
  test("replaying a log in a fresh process reproduces the recorded hash", () => {
    const args = ["--seed", "7", "--steps", "8000", "--commands", commandLog];
    const recorded = runSimProcess(args);

    const replayed = runSimProcess(args);

    expect(replayed.hash).toBe(recorded.hash);
  });

  test("a log with every tick shifted by one produces a different hash", () => {
    const entries = JSON.parse(readFileSync(commandLog, "utf8")) as {
      tick: number;
    }[];
    const shiftedPath = join(dir, "shifted.json");
    writeFileSync(
      shiftedPath,
      JSON.stringify(entries.map((e) => ({ ...e, tick: e.tick + 1 }))),
    );
    const base = ["--seed", "42", "--steps", "10000", "--commands"];

    const original = runSimProcess([...base, commandLog]);
    const shifted = runSimProcess([...base, shiftedPath]);

    expect(shifted.hash).not.toBe(original.hash);
  });
});

describe("golden", () => {
  // Intended behavior changes break this test. Regenerate with `bun run golden:update`
  // and say in the commit message why the hash changed.
  test("seed 42 for 10,000 steps with the fixture log matches the committed hash", () => {
    const golden = JSON.parse(
      readFileSync(join(import.meta.dir, "golden.json"), "utf8"),
    ) as {
      seed: number;
      steps: number;
      commands: string;
      grant: string[];
      hash: string;
    };

    const summary = runSimProcess([
      "--seed",
      String(golden.seed),
      "--steps",
      String(golden.steps),
      "--commands",
      golden.commands,
      "--grant",
      golden.grant.join(","),
    ]);

    expect(summary.hash).toBe(golden.hash);
  });
});
