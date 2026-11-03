import { describe, expect, test } from "bun:test";
import { contextFor, setRoster, tuning } from "../../test/helpers";
import { Game } from "./game";
import { NO_LABOR_POLICY } from "./labor";
import { Job } from "./realm";

const flows = { harvest: 0, wood: 0, ore: 0 };

function villageOf(idle: number) {
  const game = Game.create(1, tuning);
  setRoster(game, { idle });
  return game;
}

function enactLabor(game: Game, policy: string) {
  game.decrees.enact({
    id: "workforce",
    petition: "labor",
    rules: [],
    otherwise: policy,
  });
}

function runTicks(game: Game, ticks: number) {
  for (let i = 0; i < ticks; i++) game.decrees.run(contextFor(game), flows);
}

function assign(game: Game, peasant: number, job: Job) {
  expect(
    game.commands.apply(
      { type: "assignPeasant", peasant, job },
      contextFor(game),
    ),
  ).toEqual({ ok: true });
}

function jobOf(game: Game, peasant: number) {
  return game.delegates.findById(peasant)?.job;
}

describe("settling a labor decree", () => {
  test("enacting a decree moves peasants until the split is reached, then stops", () => {
    const game = villageOf(4);
    enactLabor(game, "farm");

    runTicks(game, 2);

    expect(game.delegates.jobCounts().farm).toBe(2);
    expect(game.labor.settling).toBe(true);

    runTicks(game, 2);

    expect(game.delegates.jobCounts().farm).toBe(4);
    expect(game.labor.settling).toBe(false);
  });

  test("a hand assignment sticks while the policy is unchanged and is overridden when it changes", () => {
    const game = villageOf(4);
    enactLabor(game, "farm");
    runTicks(game, 4);

    assign(game, 1, Job.FOREST);
    runTicks(game, 5);

    expect(jobOf(game, 1)).toBe(Job.FOREST);
    expect(game.delegates.jobCounts().farm).toBe(3);

    enactLabor(game, "mine");
    runTicks(game, 5);

    expect(jobOf(game, 1)).toBe(Job.MINE);
    expect(game.delegates.jobCounts().mine).toBe(4);
  });

  test("a rule switching the chosen policy settles again", () => {
    const game = villageOf(4);
    game.decrees.enact({
      id: "workforce",
      petition: "labor",
      rules: [
        {
          when: {
            kind: "compare",
            quantity: "grain",
            comparison: "above",
            value: 10,
          },
          policy: "mine",
        },
      ],
      otherwise: "farm",
    });
    game.state.posting.resources.grain = 0;
    runTicks(game, 4);
    assign(game, 1, Job.FOREST);
    runTicks(game, 2);

    expect(jobOf(game, 1)).toBe(Job.FOREST);

    game.state.posting.resources.grain = 100;
    runTicks(game, 5);

    expect(game.delegates.jobCounts().mine).toBe(4);
  });

  test("an accepted hand assignment during settling ends settling, and a rejected one does not", () => {
    const settled = villageOf(4);
    const rejected = villageOf(4);
    enactLabor(settled, "farm");
    enactLabor(rejected, "farm");
    runTicks(settled, 1);
    runTicks(rejected, 1);

    assign(settled, 4, Job.FOREST);
    const result = rejected.commands.apply(
      { type: "assignPeasant", peasant: 999, job: Job.FOREST },
      contextFor(rejected),
    );
    runTicks(settled, 4);
    runTicks(rejected, 3);

    expect(settled.labor.settling).toBe(false);
    expect(settled.delegates.jobCounts()).toMatchObject({
      farm: 1,
      forest: 1,
      idle: 2,
    });
    expect(result.ok).toBe(false);
    expect(rejected.delegates.jobCounts().farm).toBe(4);
  });

  test("repealing forgets the policy, so re-enacting the same decree settles again", () => {
    const game = villageOf(4);
    enactLabor(game, "farm");
    runTicks(game, 4);
    assign(game, 1, Job.FOREST);

    game.decrees.repeal("workforce");

    expect(game.labor.policy).toBe(NO_LABOR_POLICY);
    expect(game.labor.settling).toBe(false);

    enactLabor(game, "farm");
    runTicks(game, 2);

    expect(jobOf(game, 1)).toBe(Job.FARM);
  });
});

describe("newborn placement under a labor decree", () => {
  test("a newborn takes the job furthest below the split and leaves hand-placed peasants alone", () => {
    const game = villageOf(10);
    enactLabor(game, "balanced");
    runTicks(game, 10);
    assign(game, 1, Job.MINE);
    const before = game.delegates.all.map((delegate) => delegate.job);

    game.economy.feedGrain(tuning.economy.grainPerPeasant, contextFor(game));

    const newborn = game.delegates.all.at(-1);
    expect(newborn?.job).toBe(Job.FARM);
    expect(game.delegates.all.slice(0, -1).map((d) => d.job)).toEqual(before);
    expect(game.labor.settling).toBe(false);
  });

  test("a newborn stays idle when no labor decree is in force", () => {
    const game = villageOf(10);

    game.economy.feedGrain(tuning.economy.grainPerPeasant, contextFor(game));

    expect(game.delegates.all.at(-1)?.job).toBe(Job.IDLE);
  });
});
