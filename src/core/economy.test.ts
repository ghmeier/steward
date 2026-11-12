import { describe, expect, test } from "bun:test";
import {
  uncappedContext as context,
  tuning as realTuning,
  setRoster,
  economyTestTuning as tuning,
} from "../../test/helpers";
import { Game } from "./game";
import { Job, type Season, type WorkingJob } from "./realm";

const perSeason = tuning.economy.ticksPerSeason;
const winter = 3 * perSeason + 1;

function villageAt(
  tick: number,
  village: {
    population?: number;
    labor?: { farm?: number; forest?: number; mine?: number };
    grain?: number;
  },
) {
  const game = Game.create(1, tuning);
  game.state.tick = tick;
  const labor = { farm: 0, forest: 0, mine: 0, ...village.labor };
  const working = labor.farm + labor.forest + labor.mine;
  setRoster(game, { ...labor, idle: (village.population ?? 10) - working });
  game.state.posting.resources.grain = village.grain ?? 1000;
  return game;
}

function starveFor(game: Game, ticks: number): void {
  for (let i = 0; i < ticks; i++) game.economy.run(context);
}

test.each<[number, Season]>([
  [0, "spring"],
  [600, "spring"],
  [601, "summer"],
  [1201, "autumn"],
  [1801, "winter"],
  [2401, "spring"],
])("seasonAt tick %p is %s with 600 ticks per season", (tick, season) => {
  expect(Game.create(1, tuning).economy.seasonAt(tick)).toBe(season);
});

describe("runEconomy production", () => {
  // Ten people eat 0.1 a tick; a farmer makes 0.025 times the season's yield.
  type Row = {
    name: string;
    tick: number;
    labor: { farm?: number; forest?: number; mine?: number };
    grudgedMiner?: boolean;
    grain: number;
    wood: number;
    ore: number;
    harvest: number;
  };
  // biome-ignore format: one row per case
  const rows: Row[] = [
		{ name: "spring farmers", tick: 1, labor: { farm: 8 }, grain: 0.2 - 0.1, wood: 0, ore: 0, harvest: 0.1 },
		{ name: "summer farmers", tick: perSeason + 1, labor: { farm: 8 }, grain: 0.3 - 0.1, wood: 0, ore: 0, harvest: 0.2 },
		{ name: "winter farmers", tick: winter, labor: { farm: 8 }, grain: -0.1, wood: 0, ore: 0, harvest: 0 },
		{ name: "farmers whose crop falls short of upkeep", tick: 1, labor: { farm: 2 }, grain: 0.05 - 0.1, wood: 0, ore: 0, harvest: 0 },
		{ name: "foresters and miners", tick: 1, labor: { forest: 3, mine: 5 }, grain: -0.1, wood: 0.06, ore: 0.05, harvest: 0 },
		{ name: "a grudged miner produces nothing", tick: 1, labor: { mine: 1 }, grudgedMiner: true, grain: -0.1, wood: 0, ore: 0, harvest: 0 },
	];

  test.each(rows)(
    "$name",
    ({ tick, labor, grudgedMiner, grain, wood, ore, harvest }) => {
      const game = villageAt(tick, { labor });
      const miner = game.delegates.firstWithJob(Job.MINE);
      if (grudgedMiner && miner) miner.grudgeUntil = tick + 5;

      const { flows } = game.economy.run(context);

      expect(game.state.posting.resources.grain).toBeCloseTo(1000 + grain, 12);
      expect(game.state.posting.resources.wood).toBeCloseTo(wood, 12);
      expect(game.state.posting.resources.ore).toBeCloseTo(ore, 12);
      expect(game.state.posting.resources.coin).toBe(0);
      expect(flows.harvest).toBeCloseTo(harvest, 12);
    },
  );
});

describe("runEconomy eating", () => {
  test.each([
    ["plenty of grain", 5, 4.9],
    ["exactly enough grain", 0.1, 0],
  ])(
    "a village with %s pays upkeep and ends any famine",
    (_name, grain, left) => {
      const game = villageAt(1, { grain });
      game.state.posting.economy.famine = {
        startPopulation: 10,
        ticks: 7,
        deaths: 2,
      };

      game.economy.run(context);

      expect(game.state.posting.resources.grain).toBeCloseTo(left, 12);
      expect(game.state.posting.economy.famine).toEqual({
        startPopulation: 0,
        ticks: 0,
        deaths: 0,
      });
      expect(game.delegates.all.length).toBe(10);
    },
  );

  test("an unfed village empties the granary and starts a famine without killing yet", () => {
    const game = villageAt(1, { grain: 0.04 });

    game.economy.run(context);

    expect(game.state.posting.resources.grain).toBe(0);
    expect(game.state.posting.economy.famine).toEqual({
      startPopulation: 10,
      ticks: 1,
      deaths: 0,
    });
    expect(game.delegates.all.length).toBe(10);
    expect(game.state.posting.economy.starved).toBe(0);
  });

  test("deaths are spread evenly across the season and stop at half the village", () => {
    const game = villageAt(winter, { population: 37, grain: 0 });

    let elapsed = 0;
    for (const [ticks, deaths] of [
      [1, 0],
      [33, 0],
      [34, 1],
      [100, 3],
      [299, 8],
      [300, 9],
      [450, 13],
      [600, 18],
      [4 * perSeason, 18],
    ] as const) {
      starveFor(game, ticks - elapsed);
      elapsed = ticks;

      expect(game.state.posting.economy.famine.deaths).toBe(deaths);
    }
    expect(game.state.posting.economy.starved).toBe(18);
    expect(game.delegates.all.length).toBe(19);
  });

  test("a later famine takes its cap from the population at that time", () => {
    const game = villageAt(winter, { population: 20, grain: 0 });
    starveFor(game, perSeason);
    game.state.posting.resources.grain = 1000;
    game.economy.run(context);
    game.state.posting.resources.grain = 0;

    starveFor(game, 2 * perSeason);

    expect(game.state.posting.economy.famine.startPopulation).toBe(10);
    expect(game.delegates.all.length).toBe(5);
    expect(game.state.posting.economy.starved).toBe(15);
  });

  test.each([0, 1])(
    "a village of %p peasants is never starved",
    (population) => {
      const game = villageAt(winter, { population, grain: 0 });

      starveFor(game, 2 * perSeason);

      expect(game.delegates.all.length).toBe(population);
      expect(game.state.posting.economy.starved).toBe(0);
    },
  );
});

describe("idle upkeep", () => {
  const { idleGrainFactor } = realTuning.economy;
  const frugal = {
    ...tuning,
    economy: { ...tuning.economy, idleGrainFactor },
  };

  function peasants(roster: { farm?: number; idle?: number }): Game {
    const game = Game.create(1, frugal);
    setRoster(game, roster);
    return game;
  }

  test("an idle peasant eats the idle share of a working peasant's grain", () => {
    const idle = peasants({ idle: 10 });
    const working = peasants({ farm: 10 });

    expect(idle.economy.grainUpkeepPerTick()).toBeCloseTo(
      10 * tuning.economy.grainPerPerson * idleGrainFactor,
      12,
    );
    expect(working.economy.grainUpkeepPerTick()).toBeCloseTo(
      10 * tuning.economy.grainPerPerson,
      12,
    );
  });

  test("a peasant idled by a grudge eats the idle share until the grudge ends", () => {
    const game = peasants({ farm: 2 });
    const full = game.economy.grainUpkeepPerTick();
    const [peasant] = game.delegates.peasants;
    (peasant as { grudgeUntil: number }).grudgeUntil = game.state.tick + 5;

    const grudged = game.economy.grainUpkeepPerTick();
    game.state.tick += 5;

    expect(grudged).toBeLessThan(full);
    expect(game.economy.grainUpkeepPerTick()).toBe(full);
  });
});

describe("feedGrain", () => {
  type Row = {
    name: string;
    population: number;
    growth: number;
    fed: number;
    peasants: number;
    grainLeft: number;
    growthLeft: number;
  };
  // Every village starts with 100 grain.
  // biome-ignore format: one row per case
  const rows: Row[] = [
		{ name: "births carry the remainder", population: 10, growth: 10, fed: 55, peasants: 12, grainLeft: 45, growthLeft: 5 },
		{ name: "growth below the price of a peasant stays growth", population: 10, growth: 0, fed: 29, peasants: 10, grainLeft: 71, growthLeft: 29 },
		{ name: "births stop at the cap but grain below it is spent", population: 39, growth: 0, fed: 90, peasants: 40, grainLeft: 10, growthLeft: 60 },
		{ name: "nothing changes at the cap", population: 40, growth: 0, fed: 60, peasants: 40, grainLeft: 100, growthLeft: 0 },
	];

  test.each(rows)(
    "$name",
    ({ population, growth, fed, peasants, grainLeft, growthLeft }) => {
      const game = villageAt(1, { population, grain: 100 });
      game.state.posting.economy.growth = growth;

      game.economy.feedGrain(fed, context);

      expect(game.delegates.all.length).toBe(peasants);
      expect(game.delegates.jobCounts().idle).toBe(peasants);
      expect(game.state.posting.resources.grain).toBe(grainLeft);
      expect(game.state.posting.economy.growth).toBe(growthLeft);
    },
  );
});

describe("laborTargets", () => {
  const farming: Record<WorkingJob, number> = {
    farm: 0.7,
    forest: 0.2,
    mine: 0.1,
  };
  const balanced: Record<WorkingJob, number> = {
    farm: 0.5,
    forest: 0.3,
    mine: 0.2,
  };

  test.each([
    [10, farming, { farm: 7, forest: 2, mine: 1 }],
    [3, balanced, { farm: 1, forest: 1, mine: 1 }],
    [0, balanced, { farm: 0, forest: 0, mine: 0 }],
    [1, { farm: 0.5, forest: 0.5, mine: 0 }, { farm: 1, forest: 0, mine: 0 }],
  ])("%p peasants on %j give %j", (population, shares, expected) => {
    const game = Game.create(1, tuning);
    setRoster(game, { idle: population });

    expect(game.economy.laborTargets(shares)).toEqual({
      ...expected,
      idle: 0,
    });
  });
});

describe("laborTargetFor a custom split", () => {
  function targetsOf(policy: string, population: number) {
    const game = Game.create(1, tuning);
    setRoster(game, { idle: population });
    return game.economy.laborTargetFor(policy);
  }

  test.each([
    ["farm 60 forest 30 mine 10", 10, { farm: 6, forest: 3, mine: 1 }],
    ["farm 2 mine 1", 10, { farm: 7, forest: 0, mine: 3 }],
    ["farm 1 forest 1 mine 1", 4, { farm: 2, forest: 1, mine: 1 }],
    ["forest 5", 3, { farm: 0, forest: 3, mine: 0 }],
  ])(
    "%j for %p peasants gives %j, with leftovers going to the largest remainders",
    (policy, population, expected) => {
      expect(targetsOf(policy, population)).toEqual({ ...expected, idle: 0 });
    },
  );

  test.each([
    ["balanced", "farm 50 forest 30 mine 20"],
    ["farming", "farm 70 forest 20 mine 10"],
  ])("preset %s and the split %j give identical targets", (preset, split) => {
    for (const population of [0, 1, 3, 7, 10, 23]) {
      expect(targetsOf(split, population)).toEqual(
        targetsOf(preset, population),
      );
    }
  });
});

describe("grainSeasons", () => {
  // Upkeep is 10 * 0.01 * 600 = 60 per season.
  test.each([
    ["measures reserves in seasons of upkeep", 10, 150, 2.5],
    ["is zero for an empty village without grain", 0, 0, 0],
    [
      "is the maximum for an empty village holding grain",
      0,
      5,
      tuning.maxResourceValue,
    ],
  ])("%s", (_name, population, grain, expected) => {
    const game = villageAt(1, { population, grain });

    expect(game.economy.grainSeasons()).toBeCloseTo(expected, 12);
  });
});
