import type { Decree } from "./decree";
import type { Delegate } from "./delegates";
import type { DeskState } from "./desk";
import type { EconomyState } from "./economy";
import type { RngState } from "./rng";

export const SCHEMA_VERSION = 8;

export type ResourceId = string;

export type CareerState = {
  unlocks: Record<string, number>;
  savedDecrees: Record<string, Decree>;
  /** The first tick each control was needed, keyed by control; the tutorial reads it. */
  needed: Record<string, number>;
  followers: string[];
  formerStaff: string[];
  /** 0 until promotion; a promotion can only happen at tick 1 or later. */
  promotedAt: number;
};

export type PostingState = {
  postingId: string;
  seed: number;
  rng: Record<string, RngState>;
  resources: Record<ResourceId, number>;
  economy: EconomyState;
  delegates: Delegate[];
  nextDelegateId: number;
  decrees: Record<string, Decree>;
  desk: DeskState;
};

export type GameState = {
  schemaVersion: number;
  tick: number;
  career: CareerState;
  posting: PostingState;
};

/** Every stream the systems draw from; each is seeded at creation so no system seeds lazily mid-run. */
export const RNG_STREAMS = ["disputes", "names"] as const;
