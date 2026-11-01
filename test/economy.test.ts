import { describe, expect, test } from "bun:test";
import { idleCount } from "../src/core/delegates";
import {
	feedGrain,
	grainSeasons,
	laborTargets,
	runEconomy,
	seasonAt,
} from "../src/core/economy";
import type { AddContext } from "../src/core/math";
import type { Job, Season } from "../src/core/realm";
import { createNewGame } from "../src/core/state";
import { setRoster, economyTestTuning as tuning } from "./helpers";

const context: AddContext = { tick: 1, maxValue: 1e300, absorbed: null };
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
	const state = createNewGame(1, tuning);
	state.tick = tick;
	const labor = { farm: 0, forest: 0, mine: 0, ...village.labor };
	const working = labor.farm + labor.forest + labor.mine;
	setRoster(state, { ...labor, idle: (village.population ?? 10) - working });
	state.posting.resources.grain = village.grain ?? 1000;
	return state;
}

function starveFor(state: ReturnType<typeof villageAt>, ticks: number): void {
	for (let i = 0; i < ticks; i++) runEconomy(state, tuning, context);
}

test.each<[number, Season]>([
	[0, "spring"],
	[600, "spring"],
	[601, "summer"],
	[1201, "autumn"],
	[1801, "winter"],
	[2401, "spring"],
])("seasonAt tick %p is %s with 600 ticks per season", (tick, season) => {
	expect(seasonAt(tick, 600)).toBe(season);
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
			const state = villageAt(tick, { labor });
			const miner = state.posting.delegates.find((d) => d.job === "mine");
			if (grudgedMiner && miner) miner.grudgeUntil = tick + 5;

			const flows = runEconomy(state, tuning, context);

			expect(state.posting.resources.grain).toBeCloseTo(1000 + grain, 12);
			expect(state.posting.resources.wood).toBeCloseTo(wood, 12);
			expect(state.posting.resources.ore).toBeCloseTo(ore, 12);
			expect(state.posting.resources.coin).toBe(0);
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
			const state = villageAt(1, { grain });
			state.posting.economy.famine = {
				startPopulation: 10,
				ticks: 7,
				deaths: 2,
			};

			runEconomy(state, tuning, context);

			expect(state.posting.resources.grain).toBeCloseTo(left, 12);
			expect(state.posting.economy.famine).toEqual({
				startPopulation: 0,
				ticks: 0,
				deaths: 0,
			});
			expect(state.posting.delegates.length).toBe(10);
		},
	);

	test("an unfed village empties the granary and starts a famine without killing yet", () => {
		const state = villageAt(1, { grain: 0.04 });

		runEconomy(state, tuning, context);

		expect(state.posting.resources.grain).toBe(0);
		expect(state.posting.economy.famine).toEqual({
			startPopulation: 10,
			ticks: 1,
			deaths: 0,
		});
		expect(state.posting.delegates.length).toBe(10);
		expect(state.posting.economy.starved).toBe(0);
	});

	test("deaths are spread evenly across the season and stop at half the village", () => {
		const state = villageAt(winter, { population: 37, grain: 0 });

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
			starveFor(state, ticks - elapsed);
			elapsed = ticks;

			expect(state.posting.economy.famine.deaths).toBe(deaths);
		}
		expect(state.posting.economy.starved).toBe(18);
		expect(state.posting.delegates.length).toBe(19);
	});

	test("a later famine takes its cap from the population at that time", () => {
		const state = villageAt(winter, { population: 20, grain: 0 });
		starveFor(state, perSeason);
		state.posting.resources.grain = 1000;
		runEconomy(state, tuning, context);
		state.posting.resources.grain = 0;

		starveFor(state, 2 * perSeason);

		expect(state.posting.economy.famine.startPopulation).toBe(10);
		expect(state.posting.delegates.length).toBe(5);
		expect(state.posting.economy.starved).toBe(15);
	});

	test.each([0, 1])(
		"a village of %p peasants is never starved",
		(population) => {
			const state = villageAt(winter, { population, grain: 0 });

			starveFor(state, 2 * perSeason);

			expect(state.posting.delegates.length).toBe(population);
			expect(state.posting.economy.starved).toBe(0);
		},
	);
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
			const state = villageAt(1, { population, grain: 100 });
			state.posting.economy.growth = growth;

			feedGrain(state, fed, tuning, context);

			expect(state.posting.delegates.length).toBe(peasants);
			expect(idleCount(state.posting.delegates)).toBe(peasants);
			expect(state.posting.resources.grain).toBe(grainLeft);
			expect(state.posting.economy.growth).toBe(growthLeft);
		},
	);
});

describe("laborTargets", () => {
	const farming: Record<Job, number> = { farm: 0.7, forest: 0.2, mine: 0.1 };
	const balanced: Record<Job, number> = { farm: 0.5, forest: 0.3, mine: 0.2 };

	test.each([
		[10, farming, { farm: 7, forest: 2, mine: 1 }],
		[3, balanced, { farm: 1, forest: 1, mine: 1 }],
		[0, balanced, { farm: 0, forest: 0, mine: 0 }],
		[1, { farm: 0.5, forest: 0.5, mine: 0 }, { farm: 1, forest: 0, mine: 0 }],
	])("%p peasants on %j give %j", (population, shares, expected) => {
		expect(laborTargets(population, shares)).toEqual(expected);
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
		const state = villageAt(1, { population, grain });

		expect(grainSeasons(state, tuning)).toBeCloseTo(expected, 12);
	});
});
