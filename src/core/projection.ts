import { RESOURCES, type Resource } from "./realm";
import type { GameState } from "./state";
import { runFlows } from "./step";
import type { Tuning } from "./tuning";

// Runs the very phases the next step runs, on a copy, so the ledger rate cannot drift from the
// real change. Commands and the dispute desk are left out on purpose: arrivals, expiries and
// settlements are one-off events, not flows, and would make the rate jump.
export function projectedRates(
	state: GameState,
	tuning: Tuning,
): Record<Resource, number> {
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
	return rates;
}
