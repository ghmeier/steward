import type { Decree } from "./decree";
import type { EconomyState } from "./economy";
import { RESOURCES } from "./realm";
import { type RngState, seedStream } from "./rng";
import type { Tuning } from "./tuning";

export const SCHEMA_VERSION = 3;

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
	economy: EconomyState;
	decrees: Record<string, Decree>;
};

export type GameState = {
	schemaVersion: number;
	tick: number;
	career: CareerState;
	posting: PostingState;
};

/** Every stream the systems draw from; each is seeded at creation so no system seeds lazily mid-run. */
export const RNG_STREAMS = [] as const;

export function createNewGame(seed: number, tuning: Tuning): GameState {
	if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
		throw new RangeError(`seed must be a uint32, got ${seed}`);
	}
	const rng: Record<string, RngState> = {};
	const resources: Record<ResourceId, number> = {};
	for (const resource of RESOURCES) {
		resources[resource] = tuning.economy.initialResources[resource];
	}
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
			resources,
			economy: {
				population: tuning.economy.initialPopulation,
				labor: { farm: 0, forest: 0, mine: 0 },
				hunger: 0,
				growth: 0,
				starved: 0,
			},
			decrees: {},
		},
	};
}
