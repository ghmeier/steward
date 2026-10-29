import { describe, expect, test } from "bun:test";
import { idleCount, laborCounts } from "../src/core/delegates";
import {
	feedGrain,
	grainSeasons,
	laborTargets,
	moveLaborToward,
	runEconomy,
	seasonAt,
	sellGrain,
} from "../src/core/economy";
import type { AddContext } from "../src/core/math";
import type { Job, Season } from "../src/core/realm";
import { createNewGame } from "../src/core/state";
import { setRoster, economyTestTuning as tuning } from "./helpers";

const context: AddContext = { tick: 1, maxValue: 1e300, absorbed: null };
const perSeason = tuning.economy.ticksPerSeason;

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

describe("seasonAt", () => {
	test.each<[number, string]>([
		[0, "spring"],
		[1, "spring"],
		[600, "spring"],
		[601, "summer"],
		[1201, "autumn"],
		[1800, "autumn"],
		[1801, "winter"],
		[2400, "winter"],
		[2401, "spring"],
	])("tick %p is in %s with 600 ticks per season", (tick, season) => {
		expect(seasonAt(tick, 600)).toBe(season as Season);
	});
});

describe("runEconomy production", () => {
	test("farmers produce grain by the season yield", () => {
		const spring = villageAt(1, { labor: { farm: 8 } });
		const summer = villageAt(perSeason + 1, { labor: { farm: 8 } });

		runEconomy(spring, tuning, context);
		runEconomy(summer, tuning, context);

		// 1000 + 8 * 0.025 * yield - 10 * 0.01
		expect(spring.posting.resources.grain).toBeCloseTo(1000 + 0.2 - 0.1, 12);
		expect(summer.posting.resources.grain).toBeCloseTo(1000 + 0.3 - 0.1, 12);
	});

	test("farmers produce no grain in winter", () => {
		const state = villageAt(3 * perSeason + 1, { labor: { farm: 8 } });

		runEconomy(state, tuning, context);

		expect(state.posting.resources.grain).toBeCloseTo(1000 - 0.1, 12);
	});

	test("wood and ore follow their workers and nobody else's", () => {
		const state = villageAt(1, { labor: { forest: 3, mine: 5 } });

		runEconomy(state, tuning, context);

		expect(state.posting.resources.wood).toBeCloseTo(0.06, 12);
		expect(state.posting.resources.ore).toBeCloseTo(0.05, 12);
		expect(state.posting.resources.coin).toBe(0);
	});
});

describe("runEconomy eating", () => {
	test("a fed village pays upkeep and resets hunger", () => {
		const state = villageAt(1, { grain: 5 });
		state.posting.economy.hunger = 1.5;

		runEconomy(state, tuning, context);

		expect(state.posting.resources.grain).toBeCloseTo(4.9, 12);
		expect(state.posting.economy.hunger).toBe(0);
	});

	test("an unfed village empties the granary and accumulates hunger", () => {
		const state = villageAt(1, { grain: 0.04 });

		runEconomy(state, tuning, context);

		expect(state.posting.resources.grain).toBe(0);
		expect(state.posting.economy.hunger).toBeCloseTo(0.06, 12);
		expect(state.posting.delegates.length).toBe(10);
		expect(state.posting.economy.starved).toBe(0);
	});

	test("a village with exactly enough grain is fed", () => {
		const state = villageAt(1, { grain: 0.1 });
		state.posting.economy.hunger = 1;

		runEconomy(state, tuning, context);

		expect(state.posting.economy.hunger).toBe(0);
		expect(state.posting.delegates.length).toBe(10);
	});

	test("hunger at the threshold kills idle peasants before workers", () => {
		const state = villageAt(3 * perSeason + 1, {
			grain: 0,
			labor: { farm: 4, mine: 1 },
		});
		state.posting.economy.hunger = 1.95;

		runEconomy(state, tuning, context);

		// Winter, so no grain arrives: 1.95 + 0.1 reaches the threshold once, leaving 0.05.
		expect(state.posting.delegates.length).toBe(9);
		expect(laborCounts(state.posting.delegates)).toEqual({
			farm: 4,
			forest: 0,
			mine: 1,
		});
		expect(state.posting.economy.starved).toBe(1);
		expect(state.posting.economy.hunger).toBeCloseTo(0.05, 12);
	});

	test("with no idle peasants starvation takes mine, then forest, then farm", () => {
		const state = villageAt(3 * perSeason + 1, {
			population: 3,
			grain: 0,
			labor: { farm: 1, forest: 1, mine: 1 },
		});
		const deaths: number[][] = [];
		for (const hunger of [2, 2, 2]) {
			state.posting.economy.hunger = hunger;
			runEconomy(state, tuning, context);
			const { farm, forest, mine } = laborCounts(state.posting.delegates);
			deaths.push([farm, forest, mine]);
		}

		expect(deaths).toEqual([
			[1, 1, 0],
			[1, 0, 0],
			[0, 0, 0],
		]);
		expect(state.posting.economy.starved).toBe(3);
	});

	test("population never goes below zero and an empty village does nothing", () => {
		const state = villageAt(1, { population: 1, grain: 0 });
		state.posting.economy.hunger = 100;

		runEconomy(state, tuning, context);

		expect(state.posting.delegates.length).toBe(0);
		expect(state.posting.economy.starved).toBe(1);

		const before = structuredClone(state);
		runEconomy(state, tuning, context);

		expect(state.posting.delegates.length).toBe(0);
		expect(state.posting.economy.starved).toBe(before.posting.economy.starved);
		expect(state.posting.resources.grain).toBe(0);
	});
});

describe("runEconomy flows", () => {
	test("grainSurplus is production minus upkeep when production is higher", () => {
		const state = villageAt(1, { labor: { farm: 8 } });

		const flows = runEconomy(state, tuning, context);

		expect(flows.grainSurplus).toBeCloseTo(0.2 - 0.1, 12);
	});

	test("grainSurplus is zero when upkeep exceeds production", () => {
		const state = villageAt(1, { labor: { farm: 2 } });

		const flows = runEconomy(state, tuning, context);

		expect(flows.grainSurplus).toBe(0);
	});
});

describe("sellGrain", () => {
	test("converts grain to coin at the grain price", () => {
		const state = villageAt(1, { grain: 100 });

		sellGrain(state, 30, tuning, context);

		expect(state.posting.resources.grain).toBe(70);
		expect(state.posting.resources.coin).toBe(15);
	});
});

describe("feedGrain", () => {
	test("turns grain into growth and growth into idle peasants, carrying the remainder", () => {
		const state = villageAt(1, { grain: 100 });
		state.posting.economy.growth = 10;

		feedGrain(state, 55, tuning, context);

		// 10 + 55 = 65 growth is two peasants at 30 each with 5 left over.
		expect(state.posting.resources.grain).toBe(45);
		expect(state.posting.delegates.length).toBe(12);
		expect(state.posting.economy.growth).toBe(5);
		expect(idleCount(state.posting.delegates)).toBe(12);
	});

	test("keeps growth below the price of a peasant as growth only", () => {
		const state = villageAt(1, { grain: 100 });

		feedGrain(state, 29, tuning, context);

		expect(state.posting.delegates.length).toBe(10);
		expect(state.posting.economy.growth).toBe(29);
	});

	test("stops births at the population cap but still spends grain below it", () => {
		const state = villageAt(1, { population: 39, grain: 100 });

		feedGrain(state, 90, tuning, context);

		expect(state.posting.delegates.length).toBe(40);
		expect(state.posting.resources.grain).toBe(10);
		expect(state.posting.economy.growth).toBe(60);
	});

	test("changes nothing at the population cap", () => {
		const state = villageAt(1, { population: 40, grain: 100 });
		const before = structuredClone(state);

		feedGrain(state, 60, tuning, context);

		expect(state).toEqual(before);
	});
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

	test("the targets always sum to the population", () => {
		for (let population = 0; population <= 40; population++) {
			const targets = laborTargets(population, balanced);

			expect(targets.farm + targets.forest + targets.mine).toBe(population);
		}
	});
});

describe("moveLaborToward", () => {
	test("takes from idle peasants first", () => {
		const state = villageAt(1, { population: 10, labor: { mine: 4 } });

		moveLaborToward(
			state.posting.delegates,
			{ farm: 3, forest: 0, mine: 2 },
			2,
			0,
		);

		expect(laborCounts(state.posting.delegates)).toEqual({
			farm: 2,
			forest: 0,
			mine: 4,
		});
	});

	test("with nobody idle it takes from the job with the largest excess", () => {
		const state = villageAt(1, {
			population: 10,
			labor: { farm: 0, forest: 4, mine: 6 },
		});

		moveLaborToward(
			state.posting.delegates,
			{ farm: 4, forest: 3, mine: 3 },
			1,
			0,
		);

		expect(laborCounts(state.posting.delegates)).toEqual({
			farm: 1,
			forest: 4,
			mine: 5,
		});
	});

	test("moves at most the allowed number of peasants", () => {
		const state = villageAt(1, { population: 10 });

		moveLaborToward(
			state.posting.delegates,
			{ farm: 5, forest: 5, mine: 0 },
			3,
			0,
		);

		expect(laborCounts(state.posting.delegates)).toEqual({
			farm: 2,
			forest: 1,
			mine: 0,
		});
	});

	test.each([
		["with nobody idle", 10, { farm: 5, forest: 5, mine: 0 }],
		["with idle peasants left over", 10, { farm: 5, forest: 3, mine: 0 }],
	])(
		"does nothing when labor is already at the target %s",
		(_name, population, labor) => {
			const state = villageAt(1, { population, labor });
			const before = structuredClone(state.posting.delegates);

			moveLaborToward(state.posting.delegates, labor, 4, 0);

			expect(state.posting.delegates).toEqual(before);
		},
	);
});

describe("grainSeasons", () => {
	test("measures reserves in seasons of upkeep", () => {
		// Upkeep is 10 * 0.01 * 600 = 60 per season.
		const state = villageAt(1, { grain: 150 });

		expect(grainSeasons(state, tuning)).toBeCloseTo(2.5, 12);
	});

	test("is zero for an empty village without grain", () => {
		const state = villageAt(1, { population: 0, grain: 0 });

		expect(grainSeasons(state, tuning)).toBe(0);
	});

	test("is the maximum for an empty village holding grain", () => {
		const state = villageAt(1, { population: 0, grain: 5 });

		expect(grainSeasons(state, tuning)).toBe(tuning.maxResourceValue);
	});
});
