import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { quietOptions, tuning } from "../../test/helpers";
import { Game } from "../core/game";
import { Job } from "../core/realm";
import { runSim } from "./sim";
import { StrategyPlayer } from "./strategy";

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

  test("a village that only farms, feeds and sets its labor reveals every upgrade that needs neither the charter nor a governor", () => {
    const game = Game.create(1, tuning);
    const player = new StrategyPlayer({
      name: "farming-only",
      setup: [
        { type: "assignPeasant", peasant: 1, job: Job.FARM },
        {
          type: "enactDecree",
          decree: {
            id: "granary",
            petition: "harvest",
            rules: [
              {
                when: {
                  kind: "compare",
                  quantity: "grainSeasons",
                  comparison: "above",
                  value: 2,
                },
                policy: "feed",
              },
            ],
            otherwise: "stockpile",
          },
        },
        {
          type: "enactDecree",
          decree: {
            id: "workforce",
            petition: "labor",
            rules: [
              {
                when: {
                  kind: "compare",
                  quantity: "population",
                  comparison: "below",
                  value: tuning.village.promotionPopulation,
                },
                policy: "farm",
              },
            ],
            otherwise: "farming",
          },
        },
      ],
      purchases: [],
      reactions: [],
    });
    const beforePromotion = tuning.archive.entries.filter(
      ({ effects, id, shown, requires }) =>
        (effects !== undefined || id.startsWith("court.")) &&
        !requires.includes("panel.crown") &&
        shown !== undefined &&
        shown !== "promotion" &&
        shown !== "governor",
    );

    while (game.state.tick < Number(STEPS)) {
      game.steps.step(player.next(), quietOptions);
      player.observe(game);
    }

    expect(beforePromotion.length).toBeGreaterThan(0);
    for (const { id } of beforePromotion) {
      expect(game.state.career.seen[id]).toBeDefined();
    }
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
