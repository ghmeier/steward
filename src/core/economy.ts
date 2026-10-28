import { type AddContext, add } from "./math";
import { JOBS, type Job, type Resource, SEASONS, type Season } from "./realm";
import type { GameState } from "./state";
import type { Tuning } from "./tuning";

export type EconomyState = {
	population: number;
	labor: Record<Job, number>;
	hunger: number;
	growth: number;
	starved: number;
};

export type EconomyFlows = { grainSurplus: number };

export function seasonAt(tick: number, ticksPerSeason: number): Season {
	if (tick < 1) return "spring";
	const index = Math.floor((tick - 1) / ticksPerSeason) % SEASONS.length;
	return SEASONS[index] ?? "spring";
}

export function idlePeasants(economy: EconomyState): number {
	let working = 0;
	for (const job of JOBS) working += economy.labor[job];
	return economy.population - working;
}

export function grainSeasons(state: GameState, tuning: Tuning): number {
	const { economy } = tuning;
	const grain = state.posting.resources.grain ?? 0;
	const upkeepPerSeason =
		state.posting.economy.population *
		economy.grainPerPerson *
		economy.ticksPerSeason;
	if (upkeepPerSeason === 0) return grain === 0 ? 0 : tuning.maxResourceValue;
	return grain / upkeepPerSeason;
}

function grainProduced(state: GameState, tuning: Tuning): number {
	const { economy } = tuning;
	const season = seasonAt(state.tick, economy.ticksPerSeason);
	return (
		state.posting.economy.labor.farm *
		economy.grainPerFarmer *
		economy.seasonYield[season]
	);
}

function upkeepOf(state: GameState, tuning: Tuning): number {
	return state.posting.economy.population * tuning.economy.grainPerPerson;
}

// Idle peasants die first so that a starving village loses its workers last; among
// workers the order is fixed (mine, forest, farm) so replay never depends on state shape.
function killOnePeasant(economy: EconomyState): void {
	if (idlePeasants(economy) <= 0) {
		for (const job of ["mine", "forest", "farm"] as const) {
			if (economy.labor[job] > 0) {
				economy.labor[job] -= 1;
				break;
			}
		}
	}
	economy.population -= 1;
}

export function runEconomy(
	state: GameState,
	tuning: Tuning,
	context: AddContext,
): EconomyFlows {
	const settings = tuning.economy;
	const resources = state.posting.resources;
	const economy = state.posting.economy;

	const produced = grainProduced(state, tuning);
	add(resources, "grain", produced, context);
	add(
		resources,
		"wood",
		economy.labor.forest * settings.woodPerWorker,
		context,
	);
	add(resources, "ore", economy.labor.mine * settings.orePerWorker, context);

	const upkeep = upkeepOf(state, tuning);
	const grain = resources.grain ?? 0;
	if (grain >= upkeep) {
		add(resources, "grain", -upkeep, context);
		economy.hunger = 0;
	} else {
		economy.hunger += upkeep - grain;
		add(resources, "grain", -grain, context);
		while (
			economy.hunger >= settings.starvationHunger &&
			economy.population > 0
		) {
			killOnePeasant(economy);
			economy.hunger -= settings.starvationHunger;
			economy.starved += 1;
		}
	}

	return { grainSurplus: Math.max(0, produced - upkeep) };
}

export function sellGrain(
	state: GameState,
	amount: number,
	tuning: Tuning,
	context: AddContext,
): void {
	const resources = state.posting.resources;
	add(resources, "grain", -amount, context);
	add(resources, "coin", amount * tuning.economy.grainPrice, context);
}

export function feedGrain(
	state: GameState,
	amount: number,
	tuning: Tuning,
	context: AddContext,
): void {
	const settings = tuning.economy;
	const economy = state.posting.economy;
	if (economy.population >= settings.maxPopulation) return;

	add(state.posting.resources, "grain", -amount, context);
	economy.growth += amount;
	while (
		economy.growth >= settings.grainPerPeasant &&
		economy.population < settings.maxPopulation
	) {
		economy.population += 1;
		economy.growth -= settings.grainPerPeasant;
	}
}

export function laborTargets(
	population: number,
	shares: Readonly<Record<Job, number>>,
): Record<Job, number> {
	const targets: Record<Job, number> = { farm: 0, forest: 0, mine: 0 };
	const remainders: Record<Job, number> = { farm: 0, forest: 0, mine: 0 };
	let assigned = 0;
	for (const job of JOBS) {
		const exact = population * shares[job];
		const whole = Math.floor(exact);
		targets[job] = whole;
		remainders[job] = exact - whole;
		assigned += whole;
	}
	for (let left = population - assigned; left > 0; left--) {
		let best: Job | null = null;
		for (const job of JOBS) {
			if (best === null || remainders[job] > remainders[best]) best = job;
		}
		if (best === null) break;
		targets[best] += 1;
		// A job gets at most one leftover peasant.
		remainders[best] = -1;
	}
	return targets;
}

export function moveLaborToward(
	economy: EconomyState,
	target: Readonly<Record<Job, number>>,
	moves: number,
): void {
	for (let done = 0; done < moves; done++) {
		let short: Job | null = null;
		let shortBy = 0;
		for (const job of JOBS) {
			const gap = target[job] - economy.labor[job];
			if (gap > shortBy) {
				short = job;
				shortBy = gap;
			}
		}
		if (short === null) return;

		if (idlePeasants(economy) <= 0) {
			let source: Job | null = null;
			let excess = 0;
			for (const job of JOBS) {
				const over = economy.labor[job] - target[job];
				if (over > excess) {
					source = job;
					excess = over;
				}
			}
			if (source === null) return;
			economy.labor[source] -= 1;
		}
		economy.labor[short] += 1;
	}
}

export function steadyRates(
	state: GameState,
	tuning: Tuning,
): Record<Resource, number> {
	const settings = tuning.economy;
	const labor = state.posting.economy.labor;
	return {
		coin: 0,
		grain: grainProduced(state, tuning) - upkeepOf(state, tuning),
		ore: labor.mine * settings.orePerWorker,
		wood: labor.forest * settings.woodPerWorker,
	};
}
