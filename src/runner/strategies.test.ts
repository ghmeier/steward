import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archiveUpgrades, quietOptions, tuning } from "../../test/helpers";
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

  test("a village that farms, feeds and sets its labor reveals every first-tier upgrade within the run", () => {
    const game = Game.create(1, tuning);
    const player = new StrategyPlayer({
      name: "farming",
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
    const firstTier = archiveUpgrades.filter(
      ({ shown, requires }) =>
        typeof shown === "object" && !requires.includes("panel.crown"),
    );

    while (game.state.tick < Number(STEPS)) {
      game.steps.step(player.next(), quietOptions);
      player.observe(game);
    }

    const unseen = firstTier
      .map(({ id }) => id)
      .filter((id) => !game.unlocks.isSeen(id));
    expect(unseen).toEqual([]);
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
