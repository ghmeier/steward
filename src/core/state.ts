import { type RngState, seedStream } from "./rng";
import type { Tuning } from "./tuning";

export const SCHEMA_VERSION = 1;

export type ResourceId = string;

export type CareerState = {
	unlocks: Record<string, number>;
	savedDecrees: Record<string, unknown>;
	followers: string[];
	formerStaff: string[];
};

export type PostingState = {
	postingId: string;
	seed: number;
	rng: Record<string, RngState>;
	resources: Record<ResourceId, number>;
	toy: { growthPerTick: number };
};

export type GameState = {
	schemaVersion: number;
	tick: number;
	career: CareerState;
	posting: PostingState;
};

/** Every stream the systems draw from; each is seeded at creation so no system seeds lazily mid-run. */
export const RNG_STREAMS = ["toy"] as const;

export function createNewGame(seed: number, tuning: Tuning): GameState {
	if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
		throw new RangeError(`seed must be a uint32, got ${seed}`);
	}
	const rng: Record<string, RngState> = {};
	for (const name of RNG_STREAMS) {
		rng[name] = seedStream(seed, name);
	}
	return {
		schemaVersion: SCHEMA_VERSION,
		tick: 0,
		career: { unlocks: {}, savedDecrees: {}, followers: [], formerStaff: [] },
		posting: {
			postingId: "posting-1",
			seed,
			rng,
			resources: { [tuning.toy.resource]: 0 },
			toy: { growthPerTick: tuning.toy.initialGrowthPerTick },
		},
	};
}
