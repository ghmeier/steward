import { RESOURCES, type Resource } from "./realm";
import type { GameState } from "./state";
import { runFlows } from "./step";
import type { Tuning } from "./tuning";

export type FlowProjection = {
	rates: Record<Resource, number>;
	growthPerTick: number;
};

// Runs the very phases the next step runs, on a copy, so the ledger rate cannot drift from the
// real change. Commands and the dispute desk are left out on purpose: arrivals, expiries and
// settlements are one-off events, not flows, and would make the rate jump.
export function projectFlows(state: GameState, tuning: Tuning): FlowProjection {
	const next = structuredClone(state);
	next.tick += 1;
	runFlows(next, tuning, {
		tick: next.tick,
		maxValue: tuning.maxResourceValue,
		absorbed: null,
	});

	const rates = {} as Record<Resource, number>;
	for (const resource of RESOURCES) {
		rates[resource] =
			(next.posting.resources[resource] ?? 0) -
			(state.posting.resources[resource] ?? 0);
	}
	// A birth subtracts grainPerPeasant from the stored growth, so add it back per newborn to
	// report the grain actually fed rather than a negative change.
	const known = new Set(state.posting.delegates.map((delegate) => delegate.id));
	const births = next.posting.delegates.filter(
		(delegate) => !known.has(delegate.id),
	).length;
	const growthPerTick =
		next.posting.economy.growth -
		state.posting.economy.growth +
		tuning.economy.grainPerPeasant * births;
	return { rates, growthPerTick };
}

export function projectedRates(
	state: GameState,
	tuning: Tuning,
): Record<Resource, number> {
	return projectFlows(state, tuning).rates;
}
