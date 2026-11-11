import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tuning } from "../../test/helpers";
import { Game } from "../core/game";
import { CROWN_CORRESPONDENCE } from "../core/unlocks";
import { runSim } from "./sim";
import {
  createStrategyPlayer,
  parseStrategy,
  type StrategyStats,
} from "./strategy";

const STEPS = "24000";

type Summary = {
  hash: string;
  population: number;
  starved: number;
  minPopulation: number;
  rejectedCommands: unknown[];
  crown: { met: number; missed: number; favor: number };
  illusion: { audits: { backed: number; deepened: number; failed: number } };
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

  test("a strategy that never retunes after promotion misses most demands", () => {
    const { crown } = play("reference");

    expect(crown.missed).toBeGreaterThan(crown.met);
  });

  test("crown-aware meets most demands by reacting to what the crown asks for", () => {
    const { crown, rejectedCommands } = play("crown-aware", [
      "--grant",
      CROWN_CORRESPONDENCE,
    ]);

    expect(rejectedCommands).toEqual([]);
    expect(crown.met).toBeGreaterThan(crown.missed);
    expect(crown.met).toBeGreaterThan(0);
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

describe("repaying illusion over ten game years", () => {
  const SEEDS = [1, 7, 42];

  function playSeed(name: string, seed: number): Summary {
    return run([
      "--seed",
      String(seed),
      "--steps",
      STEPS,
      "--strategy",
      `strategies/${name}.json`,
      "--grant",
      CROWN_CORRESPONDENCE,
    ]);
  }

  test.each(SEEDS)(
    "seed %i: a borrower that forges to bridge grain demands and then backs its debt ends with more favor than crown-aware and no fewer demands met",
    (seed) => {
      const borrower = playSeed("borrower", seed);
      const careful = playSeed("crown-aware", seed);

      expect(careful.crown.missed).toBeGreaterThan(0);
      expect(borrower.crown.favor).toBeGreaterThan(careful.crown.favor);
      expect(borrower.crown.met).toBeGreaterThanOrEqual(careful.crown.met);
      expect(borrower.illusion.audits.failed).toBe(0);
    },
  );

  test.each(SEEDS)(
    "seed %i: a conjurer that never repays ends cold with the most audits failed",
    (seed) => {
      const conjurer = playSeed("conjurer", seed);
      const borrower = playSeed("borrower", seed);
      const careful = playSeed("crown-aware", seed);

      expect(conjurer.crown.favor).toBeLessThan(tuning.crown.favor.coldBelow);
      expect(conjurer.illusion.audits.failed).toBeGreaterThan(
        borrower.illusion.audits.failed,
      );
      expect(conjurer.illusion.audits.failed).toBeGreaterThan(
        careful.illusion.audits.failed,
      );
    },
  );
});

describe("promotion under the reference strategy", () => {
  test("reference has its first birth within three minutes, is promoted within ten years at the first tick the village reaches the target, and stays promoted", () => {
    const strategy = parseStrategy(
      JSON.parse(readFileSync("strategies/reference.json", "utf8")),
      tuning.decrees,
    );
    const player = createStrategyPlayer(strategy);
    const game = Game.create(1, tuning);
    let firstAtTarget = 0;
    let firstBirth = 0;
    let unpromotedAfter = false;

    game.steps.runSteps(
      24000,
      [],
      { absorbed: null, validateEvery: 0 },
      () => {
        if (
          firstBirth === 0 &&
          game.state.posting.nextDelegateId >
            tuning.economy.initialPopulation + 1
        ) {
          firstBirth = game.state.tick;
        }
        if (
          firstAtTarget === 0 &&
          game.state.posting.delegates.length >=
            tuning.village.promotionPopulation
        ) {
          firstAtTarget = game.state.tick;
        }
        if (firstAtTarget > 0 && game.state.career.promotedAt === 0) {
          unpromotedAfter = true;
        }
        player.observe(game);
      },
      player.next,
    );

    const threeMinutesInTicks = (3 * 60 * 1000) / tuning.stepMs;
    expect(firstBirth).toBeGreaterThan(0);
    expect(firstBirth).toBeLessThanOrEqual(threeMinutesInTicks);
    expect(game.state.career.promotedAt).toBeGreaterThan(0);
    expect(game.state.career.promotedAt).toBe(firstAtTarget);
    expect(unpromotedAfter).toBe(false);
  });
});

describe("governing over ten game years", () => {
  test.each([1, 7, 42])(
    "seed %i: a strategy that hires every candidate ends with a larger population than crown-aware and starves no more",
    (seed) => {
      const options = [
        "--seed",
        String(seed),
        "--steps",
        STEPS,
        "--grant",
        CROWN_CORRESPONDENCE,
        "--strategy",
      ];

      const governing = run([...options, "strategies/governor.json"]);
      const careful = run([...options, "strategies/crown-aware.json"]);

      expect(governing.rejectedCommands).toEqual([]);
      expect(governing.population).toBeGreaterThan(careful.population);
      expect(governing.starved).toBeLessThanOrEqual(careful.starved);
    },
  );
});
