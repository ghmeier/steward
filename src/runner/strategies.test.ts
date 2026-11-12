import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSim } from "./sim";

const STEPS = "24000";

type Summary = {
  hash: string;
  starved: number;
  promotedAt: number;
};

function run(argv: string[]): Summary {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = runSim(argv, {
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
  });
  expect(stderr).toEqual([]);
  expect(code).toBe(0);
  return JSON.parse(stdout.at(-1) as string) as Summary;
}

function play(name: string, extra: string[] = []): Summary {
  return run([
    "--seed",
    "1",
    "--steps",
    STEPS,
    "--strategy",
    `strategies/${name}.json`,
    ...extra,
  ]);
}

describe("scripted strategies over ten game years", () => {
  test("the reference strategy never starves and is promoted within the run", () => {
    const summary = play("reference");

    expect(summary.starved).toBe(0);
    expect(summary.promotedAt).toBeGreaterThan(0);
  });

  test("a recorded seasonal run replays to the same hash", () => {
    const record = join(
      mkdtempSync(join(tmpdir(), "steward-rec-")),
      "log.json",
    );
    const played = play("seasonal", ["--record", record]);

    const replayed = run([
      "--seed",
      "1",
      "--steps",
      STEPS,
      "--commands",
      record,
    ]);

    expect(readFileSync(record, "utf8")).toContain("enactDecree");
    expect(replayed.hash).toBe(played.hash);
  });
});
