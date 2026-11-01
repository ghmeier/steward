import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNewGame } from "../src/core/state";
import { runSteps } from "../src/core/step";
import { runSim } from "../src/runner/sim";
import {
  createStrategyPlayer,
  parseStrategy,
  type StrategyStats,
} from "../src/runner/strategy";
import { tuning } from "./helpers";

const STEPS = "24000";

type Summary = {
  hash: string;
  population: number;
  starved: number;
  minPopulation: number;
  rejectedCommands: unknown[];
  strategy: { name: string } & StrategyStats;
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
  test("reference never starves, grows the village and never has to act again", () => {
    const summary = play("reference");

    expect(summary.starved).toBe(0);
    expect(summary.population).toBeGreaterThan(
      tuning.economy.initialPopulation,
    );
    expect(summary.strategy.reactionCommands).toBe(0);
    expect(summary.strategy.longestQuietTicks).toBe(24000);
  });

  test("none keeps its lone peasant because one peasant never starves", () => {
    const summary = play("none");

    expect(summary.starved).toBe(0);
    expect(summary.population).toBe(tuning.economy.initialPopulation);
  });

  test("naive lets people starve but famine never empties the village", () => {
    const summary = play("naive");

    expect(summary.starved).toBeGreaterThan(0);
    expect(summary.minPopulation).toBeGreaterThan(0);
  });

  test("seasonal grows without starving but has to act at least once a year", () => {
    const summary = play("seasonal");

    expect(summary.starved).toBe(0);
    expect(summary.population).toBeGreaterThan(
      tuning.economy.initialPopulation,
    );
    expect(summary.strategy.reactionCommands).toBeGreaterThan(0);
    expect(summary.strategy.longestQuietTicks).toBeLessThan(
      4 * tuning.economy.ticksPerSeason,
    );
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

describe("promotion under the reference strategy", () => {
  test("reference has its first birth within three minutes, is promoted within ten years at the first tick the village reaches the target, and stays promoted", () => {
    const strategy = parseStrategy(
      JSON.parse(readFileSync("strategies/reference.json", "utf8")),
      tuning.decrees,
    );
    const player = createStrategyPlayer(strategy);
    const state = createNewGame(1, tuning);
    let firstAtTarget = 0;
    let firstBirth = 0;
    let unpromotedAfter = false;

    runSteps(
      state,
      24000,
      tuning,
      [],
      { absorbed: null, validate: false },
      () => {
        if (
          firstBirth === 0 &&
          state.posting.nextDelegateId > tuning.economy.initialPopulation + 1
        ) {
          firstBirth = state.tick;
        }
        if (
          firstAtTarget === 0 &&
          state.posting.delegates.length >= tuning.village.promotionPopulation
        ) {
          firstAtTarget = state.tick;
        }
        if (firstAtTarget > 0 && state.career.promotedAt === 0) {
          unpromotedAfter = true;
        }
        player.observe(state, tuning);
      },
      player.next,
    );

    const threeMinutesInTicks = (3 * 60 * 1000) / tuning.stepMs;
    expect(firstBirth).toBeGreaterThan(0);
    expect(firstBirth).toBeLessThanOrEqual(threeMinutesInTicks);
    expect(state.career.promotedAt).toBeGreaterThan(0);
    expect(state.career.promotedAt).toBe(firstAtTarget);
    expect(unpromotedAfter).toBe(false);
  });
});
