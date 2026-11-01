import { describe, expect, test } from "bun:test";
import { feedGrain, moveLaborToward, runEconomy } from "../src/core/economy";
import type { AddContext } from "../src/core/math";
import type { Job } from "../src/core/realm";
import { createNewGame, type GameState } from "../src/core/state";
import {
  type RosterCounts,
  setFamineDue,
  setRoster,
  economyTestTuning as tuning,
} from "./helpers";

const context: AddContext = { tick: 1, maxValue: 1e300, absorbed: null };

const namesOf = (state: GameState) =>
  state.posting.delegates.map((delegate) => delegate.name);
const idsOf = (state: GameState) =>
  state.posting.delegates.map((delegate) => delegate.id);

function starve(state: GameState, deaths: number): void {
  state.posting.resources.grain = 0;
  state.tick = 3 * tuning.economy.ticksPerSeason + 1;
  setFamineDue(state, deaths, tuning.economy.ticksPerSeason);
  runEconomy(state, tuning, context);
}

describe("a new game's roster", () => {
  test("holds the initial population as idle peasants with ids 1 to N, and names vary with the seed", () => {
    const state = createNewGame(5, tuning);
    const rosters = [1, 2, 3, 4, 5].map((seed) =>
      namesOf(createNewGame(seed, tuning)).join(","),
    );

    expect(idsOf(state)).toEqual(
      Array.from({ length: tuning.economy.initialPopulation }, (_, i) => i + 1),
    );
    expect(new Set(namesOf(state)).size).toBe(tuning.economy.initialPopulation);
    expect(state.posting.delegates.every((d) => d.job === "idle")).toBe(true);
    expect(new Set(rosters).size).toBe(5);
  });
});

describe("births", () => {
  test("living peasants never share a name even when the list is exactly maxPopulation long", () => {
    const exact = {
      ...tuning,
      village: {
        ...tuning.village,
        names: tuning.village.names.slice(0, tuning.economy.maxPopulation),
      },
    };
    const state = createNewGame(9, exact);
    state.posting.resources.grain = 1e6;

    feedGrain(state, 1e6, exact, context);

    expect(state.posting.delegates).toHaveLength(tuning.economy.maxPopulation);
    expect(new Set(namesOf(state)).size).toBe(tuning.economy.maxPopulation);
  });

  test("ids keep increasing after a death and are never reused", () => {
    const state = createNewGame(3, tuning);
    starve(state, 1);
    const lastBefore = state.posting.delegates.at(-1)?.id ?? 0;

    feedGrain(state, tuning.economy.grainPerPeasant, tuning, context);

    expect(idsOf(state)).not.toContain(1);
    expect(state.posting.delegates.at(-1)?.id).toBe(lastBefore + 1);
    expect(state.posting.nextDelegateId).toBe(lastBefore + 2);
  });
});

describe("starvation", () => {
  // biome-ignore format: one row per case
  const rows: [string, RosterCounts, number, number[]][] = [
		["idle first, even when workers have lower ids", { farm: 2, idle: 3 }, 1, [1, 2, 4, 5]],
		["idle before a miner", { mine: 2, idle: 1 }, 1, [1, 2]],
		["mine, then forest, lowest id first in the job", { farm: 2, forest: 2, mine: 2 }, 3, [1, 2, 4]],
		["farmers only once mine and forest are empty", { farm: 2, forest: 2, mine: 2 }, 5, [2]],
	];

  test.each(rows)("kills %s", (_name, roster, deaths, survivors) => {
    const state = createNewGame(3, tuning);
    setRoster(state, roster);

    starve(state, deaths);

    expect(idsOf(state)).toEqual(survivors);
  });
});

describe("labor moves", () => {
  type Row = {
    name: string;
    roster: RosterCounts;
    target: [farm: number, forest: number, mine: number];
    expected: string;
    grudgedIndex?: Record<number, number>;
    moves?: number;
    tick?: number;
  };
  // biome-ignore format: one row per case
  const rows: Row[] = [
		{ name: "the lowest-id idle peasant moves first", roster: { mine: 2, idle: 3 }, target: [2, 0, 2], expected: "mine mine farm idle idle" },
		{ name: "with nobody idle, the largest excess gives up its lowest id", roster: { forest: 2, mine: 3 }, target: [2, 2, 1], expected: "forest forest farm mine mine" },
		{ name: "equal shortfalls go to the earlier job", roster: { idle: 4 }, target: [2, 2, 0], expected: "farm idle idle idle" },
		{ name: "equal excesses give up the earlier job", roster: { forest: 2, mine: 2 }, target: [1, 1, 1], expected: "farm forest mine mine" },
		{ name: "a grudged idle peasant is passed over", roster: { mine: 1, idle: 3 }, grudgedIndex: { 1: 50 }, tick: 10, target: [1, 0, 1], expected: "mine idle farm idle" },
		{ name: "a grudge that has ended no longer protects", roster: { mine: 1, idle: 3 }, grudgedIndex: { 1: 50 }, tick: 50, target: [1, 0, 1], expected: "mine farm idle idle" },
		{ name: "a grudged worker in the excess job is skipped", roster: { forest: 1, mine: 3 }, grudgedIndex: { 1: 50 }, tick: 10, target: [1, 1, 2], expected: "forest mine farm mine" },
		{ name: "nobody moves when every worker in the excess job is grudged", roster: { forest: 1, mine: 2 }, grudgedIndex: { 1: 50, 2: 50 }, tick: 10, target: [1, 1, 1], expected: "forest mine mine" },
		{ name: "no more than the allowed moves", roster: { idle: 10 }, target: [5, 5, 0], moves: 3, expected: "farm forest farm idle idle idle idle idle idle idle" },
		{ name: "nothing moves at the target with nobody idle", roster: { farm: 5, forest: 5 }, target: [5, 5, 0], moves: 4, expected: "farm farm farm farm farm forest forest forest forest forest" },
		{ name: "nothing moves at the target with idle peasants left", roster: { farm: 5, forest: 3, idle: 2 }, target: [5, 3, 0], moves: 4, expected: "farm farm farm farm farm forest forest forest idle idle" },
	];

  test.each(rows)(
    "$name",
    ({ roster, target, expected, grudgedIndex = {}, moves = 1, tick = 0 }) => {
      const state = createNewGame(3, tuning);
      setRoster(state, roster);
      for (const [index, until] of Object.entries(grudgedIndex)) {
        const delegate = state.posting.delegates[Number(index)];
        if (delegate) delegate.grudgeUntil = until;
      }
      const [farm, forest, mine] = target;

      moveLaborToward(
        state.posting.delegates,
        { farm, forest, mine },
        moves,
        tick,
      );

      expect(state.posting.delegates.map((d) => d.job)).toEqual(
        expected.split(" ") as Job[],
      );
    },
  );
});
