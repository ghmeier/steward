import {
	bearPeasant,
	type Delegate,
	laborCounts,
	lowestInJob,
	removeDelegate,
	workingCounts,
} from "./delegates";
import { type AddContext, add } from "./math";
import { JOBS, type Job, type Resource, SEASONS, type Season } from "./realm";
import type { GameState } from "./state";
import type { Tuning } from "./tuning";

export type EconomyState = {
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

export function grainSeasons(state: GameState, tuning: Tuning): number {
	const { economy } = tuning;
	const grain = state.posting.resources.grain ?? 0;
	const upkeepPerSeason =
		state.posting.delegates.length *
		economy.grainPerPerson *
		economy.ticksPerSeason;
	if (upkeepPerSeason === 0) return grain === 0 ? 0 : tuning.maxResourceValue;
	return grain / upkeepPerSeason;
}

function grainProduced(state: GameState, tuning: Tuning): number {
	const { economy } = tuning;
	const season = seasonAt(state.tick, economy.ticksPerSeason);
	return (
		workingCounts(state.posting.delegates, state.tick).farm *
		economy.grainPerFarmer *
		economy.seasonYield[season]
	);
}

function upkeepOf(state: GameState, tuning: Tuning): number {
	return state.posting.delegates.length * tuning.economy.grainPerPerson;
}

// Idle peasants die first so that a starving village loses its workers last; among
// workers the order is fixed (mine, forest, farm) so replay never depends on state shape.
function killOnePeasant(delegates: Delegate[]): void {
	const victim =
		lowestInJob(delegates, "idle") ??
		lowestInJob(delegates, "mine") ??
		lowestInJob(delegates, "forest") ??
		lowestInJob(delegates, "farm");
	if (victim !== undefined) removeDelegate(delegates, victim.id);
}

export function runEconomy(
	state: GameState,
	tuning: Tuning,
	context: AddContext,
): EconomyFlows {
	const settings = tuning.economy;
	const resources = state.posting.resources;
	const { economy, delegates } = state.posting;
	const working = workingCounts(delegates, state.tick);

	const produced = grainProduced(state, tuning);
	add(resources, "grain", produced, context);
	add(resources, "wood", working.forest * settings.woodPerWorker, context);
	add(resources, "ore", working.mine * settings.orePerWorker, context);

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
			delegates.length > 0
		) {
			killOnePeasant(delegates);
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
	const { economy, delegates } = state.posting;
	if (delegates.length >= settings.maxPopulation) return;

	add(state.posting.resources, "grain", -amount, context);
	economy.growth += amount;
	while (
		economy.growth >= settings.grainPerPeasant &&
		delegates.length < settings.maxPopulation
	) {
		bearPeasant(state.posting, tuning.village.names);
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
	delegates: readonly Delegate[],
	target: Readonly<Record<Job, number>>,
	moves: number,
): void {
	for (let done = 0; done < moves; done++) {
		const labor = laborCounts(delegates);
		let short: Job | null = null;
		let shortBy = 0;
		for (const job of JOBS) {
			const gap = target[job] - labor[job];
			if (gap > shortBy) {
				short = job;
				shortBy = gap;
			}
		}
		if (short === null) return;

		let mover = lowestInJob(delegates, "idle");
		if (mover === undefined) {
			let source: Job | null = null;
			let excess = 0;
			for (const job of JOBS) {
				const over = labor[job] - target[job];
				if (over > excess) {
					source = job;
					excess = over;
				}
			}
			if (source === null) return;
			mover = lowestInJob(delegates, source);
		}
		if (mover === undefined) return;
		mover.job = short;
	}
}

export function steadyRates(
	state: GameState,
	tuning: Tuning,
): Record<Resource, number> {
	const settings = tuning.economy;
	const labor = workingCounts(state.posting.delegates, state.tick);
	return {
		coin: 0,
		grain: grainProduced(state, tuning) - upkeepOf(state, tuning),
		ore: labor.mine * settings.orePerWorker,
		wood: labor.forest * settings.woodPerWorker,
	};
}
