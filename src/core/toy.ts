import { type AddContext, add } from "./math";
import { chance, intBelow } from "./rng";
import type { GameState } from "./state";
import type { Tuning } from "./tuning";

// Throwaway system: it exists so the determinism tests have something real to catch. The
// chance roll runs every tick so the toy stream's position is part of what they compare.
export function runToySystem(
	state: GameState,
	tuning: Tuning,
	context: AddContext,
): void {
	const stream = state.posting.rng.toy;
	if (stream === undefined) throw new Error("rng stream toy is missing");
	const resources = state.posting.resources;
	const resource = tuning.toy.resource;

	add(resources, resource, state.posting.toy.growthPerTick, context);

	if (chance(stream, tuning.toy.lossChancePerMille)) {
		const loss = Math.min(
			resources[resource] ?? 0,
			1 + intBelow(stream, tuning.toy.maxLoss),
		);
		add(resources, resource, -loss, context);
	}
}
