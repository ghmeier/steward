import { emptyCrownState } from "./crown";
import { initialDeskState } from "./desk";
import { emptyEconomyState } from "./economy";
import { emptyIllusionState } from "./illusion";
import { emptyLaborState } from "./labor";
import { type RngState, seedStream } from "./rng";
import { type PostingState, type ResourceId, RNG_STREAMS } from "./state";
import type { Tuning } from "./tuning";

export type PostingStart = {
  index: number;
  /** The global tick the posting begins at, so its desk schedule and first crown demand count from there. */
  startedAt: number;
  resources: Record<ResourceId, number>;
  province: string;
  doctrine: string;
};

/** Picks from the seed rather than a random stream, so the same seed always founds the same village name. */
export function defaultVillageName(seed: number, tuning: Tuning): string {
  const { villageNames } = tuning.village;
  return villageNames[seed % villageNames.length] as string;
}

/** Builds a posting with no peasants, because naming them draws from the posting's own stream once it is in the game. */
export function newPosting(
  seed: number,
  name: string,
  tuning: Tuning,
  start: PostingStart,
): PostingState {
  const rng: Record<string, RngState> = {};
  for (const stream of RNG_STREAMS) {
    rng[stream] = seedStream(seed, stream);
  }
  const arrivals = rng.disputes;
  if (arrivals === undefined) throw new Error("the disputes stream is missing");
  return {
    index: start.index,
    startedAt: start.startedAt,
    province: start.province,
    doctrine: start.doctrine,
    name,
    seed,
    rng,
    resources: { ...start.resources },
    economy: emptyEconomyState(),
    delegates: [],
    nextDelegateId: 1,
    formerStaff: [],
    decrees: {},
    labor: emptyLaborState(),
    desk: initialDeskState(arrivals, tuning.desk, start.startedAt),
    crown: emptyCrownState(),
    illusion: emptyIllusionState(),
  };
}
