import { describe, expect, test } from "bun:test";
import { laborCounts, workingCounts } from "../src/core/delegates";
import { feedGrain, moveLaborToward, runEconomy } from "../src/core/economy";
import type { AddContext } from "../src/core/math";
import { projectedRates } from "../src/core/projection";
import { createNewGame, type GameState } from "../src/core/state";
import { setRoster, economyTestTuning as tuning } from "./helpers";

const context: AddContext = { tick: 1, maxValue: 1e300, absorbed: null };

const namesOf = (state: GameState) =>
	state.posting.delegates.map((delegate) => delegate.name);
const idsOf = (state: GameState) =>
	state.posting.delegates.map((delegate) => delegate.id);

function starve(state: GameState, deaths: number): void {
	state.posting.resources.grain = 0;
	state.tick = 3 * tuning.economy.ticksPerSeason + 1;
	for (let i = 0; i < deaths; i++) {
		state.posting.economy.hunger = tuning.economy.starvationHunger;
		runEconomy(state, tuning, context);
	}
}

describe("a new game's roster", () => {
	test("holds the initial population as idle peasants with ids 1 to N and distinct names", () => {
		const state = createNewGame(5, tuning);

		expect(idsOf(state)).toEqual(
			Array.from({ length: tuning.economy.initialPopulation }, (_, i) => i + 1),
		);
		expect(new Set(namesOf(state)).size).toBe(tuning.economy.initialPopulation);
		for (const delegate of state.posting.delegates) {
			expect(delegate.job).toBe("idle");
			expect(delegate.grudgeUntil).toBe(0);
		}
	});

	test("draws the same names for the same seed and different names for different seeds", () => {
		const seeds = [1, 2, 3, 4, 5];

		const rosters = seeds.map((seed) => namesOf(createNewGame(seed, tuning)));

		expect(namesOf(createNewGame(1, tuning))).toEqual(rosters[0] as string[]);
		expect(new Set(rosters.map((names) => names.join(","))).size).toBe(
			seeds.length,
		);
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
	test("kills the lowest-id idle peasant first, even when workers have lower ids", () => {
		const state = createNewGame(3, tuning);
		setRoster(state, { farm: 2, idle: 3 });

		starve(state, 1);

		expect(idsOf(state)).toEqual([1, 2, 4, 5]);
	});

	test("with nobody idle kills mine, then forest, lowest id first in the job", () => {
		const state = createNewGame(3, tuning);
		setRoster(state, { farm: 2, forest: 2, mine: 2 });

		starve(state, 3);

		expect(idsOf(state)).toEqual([1, 2, 4]);
		expect(laborCounts(state.posting.delegates)).toEqual({
			farm: 2,
			forest: 1,
			mine: 0,
		});
	});

	test("kills farmers only after mine and forest are empty, lowest id first", () => {
		const state = createNewGame(3, tuning);
		setRoster(state, { farm: 2, forest: 2, mine: 2 });

		starve(state, 5);

		expect(idsOf(state)).toEqual([2]);
	});

	test("does not kill a worker while an idle peasant remains", () => {
		const state = createNewGame(3, tuning);
		setRoster(state, { mine: 2, idle: 1 });

		starve(state, 1);

		expect(laborCounts(state.posting.delegates).mine).toBe(2);
	});
});

describe("grudges", () => {
	function grudged(grudgeUntil: number) {
		const state = createNewGame(3, tuning);
		setRoster(state, { farm: 4, mine: 1, idle: 5 });
		const farmer = state.posting.delegates[0];
		const miner = state.posting.delegates[4];
		if (farmer) farmer.grudgeUntil = grudgeUntil;
		if (miner) miner.grudgeUntil = grudgeUntil;
		state.posting.resources.grain = 100;
		return state;
	}

	test("a grudged peasant stays counted in labor but is left out of working counts", () => {
		const state = grudged(50);
		state.tick = 10;

		expect(laborCounts(state.posting.delegates)).toEqual({
			farm: 4,
			forest: 0,
			mine: 1,
		});
		expect(workingCounts(state.posting.delegates, state.tick)).toEqual({
			farm: 3,
			forest: 0,
			mine: 0,
		});
	});

	test("a grudged peasant adds nothing to production but is still fed", () => {
		const state = grudged(50);
		state.tick = 1;

		runEconomy(state, tuning, context);

		// Three farmers make 0.075 and all ten people eat 0.1; the miner is idle in effect.
		expect(state.posting.resources.grain).toBeCloseTo(100 + 0.075 - 0.1, 12);
		expect(state.posting.resources.ore).toBe(0);
		expect(projectedRates(state, tuning).ore).toBe(0);
	});

	test("a peasant is still grudged one tick before grudgeUntil", () => {
		const state = grudged(50);
		state.tick = 49;

		const working = workingCounts(state.posting.delegates, state.tick);

		expect(working).toEqual({ farm: 3, forest: 0, mine: 0 });
	});

	test("a peasant works again at grudgeUntil", () => {
		const state = grudged(50);
		state.tick = 50;

		const working = workingCounts(state.posting.delegates, state.tick);

		expect(working).toEqual({ farm: 4, forest: 0, mine: 1 });
	});
});

describe("labor decrees move named peasants", () => {
	test("the lowest-id idle peasant moves first", () => {
		const state = createNewGame(3, tuning);
		setRoster(state, { mine: 2, idle: 3 });

		moveLaborToward(
			state.posting.delegates,
			{ farm: 2, forest: 0, mine: 2 },
			1,
			0,
		);

		expect(state.posting.delegates.map((d) => d.job)).toEqual([
			"mine",
			"mine",
			"farm",
			"idle",
			"idle",
		]);
	});

	test("with nobody idle the lowest-id peasant of the job with the largest excess moves", () => {
		const state = createNewGame(3, tuning);
		setRoster(state, { forest: 2, mine: 3 });

		moveLaborToward(
			state.posting.delegates,
			{ farm: 2, forest: 2, mine: 1 },
			1,
			0,
		);

		expect(state.posting.delegates.map((d) => d.job)).toEqual([
			"forest",
			"forest",
			"farm",
			"mine",
			"mine",
		]);
	});

	test("with equal shortfalls the job earlier in JOBS gains the peasant", () => {
		const state = createNewGame(3, tuning);
		setRoster(state, { idle: 4 });

		moveLaborToward(
			state.posting.delegates,
			{ farm: 2, forest: 2, mine: 0 },
			1,
			0,
		);

		expect(state.posting.delegates.map((d) => d.job)).toEqual([
			"farm",
			"idle",
			"idle",
			"idle",
		]);
	});

	test("with equal excesses the lowest-id peasant of the earlier job moves", () => {
		const state = createNewGame(3, tuning);
		setRoster(state, { forest: 2, mine: 2 });

		moveLaborToward(
			state.posting.delegates,
			{ farm: 1, forest: 1, mine: 1 },
			1,
			0,
		);

		expect(state.posting.delegates.map((d) => d.job)).toEqual([
			"farm",
			"forest",
			"mine",
			"mine",
		]);
	});
});

function grudge(state: GameState, index: number, until: number): void {
	const delegate = state.posting.delegates[index];
	if (delegate === undefined) throw new Error(`no peasant at ${index}`);
	delegate.grudgeUntil = until;
}

describe("labor decrees skip grudged peasants", () => {
	test("a grudged idle peasant is passed over for the next idle one", () => {
		const state = createNewGame(3, tuning);
		setRoster(state, { mine: 1, idle: 3 });
		grudge(state, 1, 50);

		moveLaborToward(
			state.posting.delegates,
			{ farm: 1, forest: 0, mine: 1 },
			1,
			10,
		);

		expect(state.posting.delegates.map((d) => d.job)).toEqual([
			"mine",
			"idle",
			"farm",
			"idle",
		]);
	});

	test("the same idle peasant is taken once the grudge has ended", () => {
		const state = createNewGame(3, tuning);
		setRoster(state, { mine: 1, idle: 3 });
		grudge(state, 1, 50);

		moveLaborToward(
			state.posting.delegates,
			{ farm: 1, forest: 0, mine: 1 },
			1,
			50,
		);

		expect(state.posting.delegates.map((d) => d.job)).toEqual([
			"mine",
			"farm",
			"idle",
			"idle",
		]);
	});

	test("a grudged worker in the excess job is skipped for the next one", () => {
		const state = createNewGame(3, tuning);
		setRoster(state, { forest: 1, mine: 3 });
		grudge(state, 1, 50);

		moveLaborToward(
			state.posting.delegates,
			{ farm: 1, forest: 1, mine: 2 },
			1,
			10,
		);

		expect(state.posting.delegates.map((d) => d.job)).toEqual([
			"forest",
			"mine",
			"farm",
			"mine",
		]);
	});

	test("when every worker in the excess job is grudged nobody moves", () => {
		const state = createNewGame(3, tuning);
		setRoster(state, { forest: 1, mine: 2 });
		for (const d of state.posting.delegates.slice(1)) d.grudgeUntil = 50;
		const before = structuredClone(state.posting.delegates);

		moveLaborToward(
			state.posting.delegates,
			{ farm: 1, forest: 1, mine: 1 },
			1,
			10,
		);

		expect(state.posting.delegates).toEqual(before);
	});
});
