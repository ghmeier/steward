import { describe, expect, test } from "bun:test";
import {
  economyTestTuning,
  quietOptions,
  sampleVillage,
  setRoster,
  tuning,
} from "../../test/helpers";
import type { CommandLogEntry } from "./commands";
import { Game } from "./game";
import { Job } from "./realm";

const assign = (tick: number, peasant: number, job: Job): CommandLogEntry => ({
  tick,
  command: { type: "assignPeasant", peasant, job },
});

describe("step", () => {
  test("returns one result per command and applies assignments before the economy runs", () => {
    const game = Game.create(42, economyTestTuning);
    const startingGrain = economyTestTuning.economy.initialResources.grain;
    const [first] = game.delegates.all;

    const results = game.steps.step(
      [
        { type: "noop" },
        { type: "assignPeasant", peasant: 999, job: Job.MINE },
        { type: "assignPeasant", peasant: first?.id ?? 0, job: Job.FARM },
      ],
      quietOptions,
    );

    expect(game.state.tick).toBe(1);
    expect(results.map((result) => result.ok)).toEqual([true, false, true]);
    expect(game.delegates.jobCounts().farm).toBe(1);
    // Tick 1 is spring: one farmer yields 0.025 before 10 people eat 0.1.
    expect(game.state.posting.resources.grain).toBeCloseTo(
      startingGrain + 0.025 - 0.1,
      12,
    );
  });

  function corruptedGame(): Game {
    const game = Game.create(42, tuning);
    game.state.posting.resources.bad = Number.NaN;
    return game;
  }

  test("validating every step throws naming the first tick when the state is invalid", () => {
    const game = corruptedGame();

    expect(() =>
      game.steps.step([], { absorbed: null, validateEvery: 1 }),
    ).toThrow(/tick 1/);
  });

  test("validating every third step reports an invalid state at the next multiple of three and not before", () => {
    const game = corruptedGame();
    const options = { absorbed: null, validateEvery: 3 };

    expect(() => game.steps.step([], options)).not.toThrow();
    expect(() => game.steps.step([], options)).not.toThrow();
    expect(() => game.steps.step([], options)).toThrow(/tick 3/);
  });

  test("an interval of zero never validates", () => {
    const game = corruptedGame();

    expect(() =>
      game.steps.runSteps(10, [], { absorbed: null, validateEvery: 0 }),
    ).not.toThrow();
  });
});

describe("promotion", () => {
  const target = economyTestTuning.village.promotionPopulation;

  function villageOf(population: number): Game {
    const game = Game.create(1, economyTestTuning);
    setRoster(game, { idle: population });
    return game;
  }

  test("fires at the first step where the population reaches the target, and not before", () => {
    const game = villageOf(target - 1);
    game.steps.runSteps(5, [], quietOptions);
    expect(game.state.career.promotedAt).toBe(0);

    game.delegates.create();
    game.steps.step([], quietOptions);

    expect(game.state.career.promotedAt).toBe(game.state.tick);
    expect(game.state.tick).toBe(6);
  });

  test("stays set after the population falls below the target", () => {
    const game = villageOf(target);
    game.steps.step([], quietOptions);

    setRoster(game, { idle: 2 });
    game.steps.runSteps(3, [], quietOptions);

    expect(game.state.career.promotedAt).toBe(1);
  });
});

describe("runSteps", () => {
  test("keeps state valid across 10,000 validated steps of a ten-peasant village", () => {
    const game = sampleVillage(42);
    const jobs = [Job.FARM, Job.FOREST, Job.MINE];
    const ids = game.delegates.all.map((delegate) => delegate.id);
    const log = [
      ...ids.map((id, i) => assign(i + 1, id, jobs[i % 3] ?? Job.FARM)),
      assign(3000, ids[0] ?? 0, Job.IDLE),
      assign(3001, ids[0] ?? 0, Job.FOREST),
    ];

    expect(() =>
      game.steps.runSteps(10_000, log, { absorbed: null, validateEvery: 1 }),
    ).not.toThrow();
    expect(game.state.tick).toBe(10_000);
  });

  test.each([
    ["skips entries for ticks already passed", 2, 0],
    ["applies entries for the tick being produced", 6, 1],
  ])("when resuming at tick 5 it %s", (_name, entryTick, farmers) => {
    const game = Game.create(42, tuning);
    game.state.tick = 5;
    const [first] = game.delegates.all;

    game.steps.runSteps(
      3,
      [assign(entryTick, first?.id ?? 0, Job.FARM)],
      quietOptions,
    );

    expect(game.delegates.jobCounts().farm).toBe(farmers);
  });

  test("applies same-tick entries in file order", () => {
    const game = Game.create(42, tuning);
    const [first] = game.delegates.all;
    const id = first?.id ?? 0;
    const log = [
      assign(1, id, Job.FARM),
      assign(1, id, Job.IDLE),
      assign(1, id, Job.MINE),
    ];

    game.steps.runSteps(1, log, quietOptions);

    expect(game.delegates.firstWithJob(Job.MINE)?.id).toBe(id);
    expect(game.delegates.jobCounts()).toEqual({
      farm: 0,
      forest: 0,
      mine: 1,
      idle: tuning.economy.initialPopulation - 1,
    });
  });
});
