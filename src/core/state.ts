import type { CrownState } from "./crown";
import type { Decree } from "./decree";
import type { Delegate } from "./delegates";
import type { DeskState } from "./desk";
import type { EconomyState } from "./economy";
import type { Follower, FormerGovernor } from "./governors";
import type { IllusionState } from "./illusion";
import type { LaborState } from "./labor";
import type { PostingRecord } from "./prestige";
import type { RngState } from "./rng";

export const SCHEMA_VERSION = 20;

export type ResourceId = string;

export type CareerState = {
  unlocks: Record<string, number>;
  savedDecrees: Record<string, Decree>;
  /** The first tick each Archive entry was revealed. Revealing latches, because the stock that revealed it can fall back. */
  seen: Record<string, number>;
  /** Governors who go with the steward into the next posting, chosen when a posting ends. */
  followers: Follower[];
  /** One record for each posting that has ended, oldest first. */
  postings: PostingRecord[];
  /** 0 until promotion; a promotion can only happen at tick 1 or later. */
  promotedAt: number;
};

export type PostingState = {
  /** Counts from 1 across the career. */
  index: number;
  /** The global tick this posting began at; 0 for the first. */
  startedAt: number;
  /** Which province the steward was sent to; empty for the first posting. */
  province: string;
  /** Empty for the first posting. */
  doctrine: string;
  name: string;
  seed: number;
  rng: Record<string, RngState>;
  resources: Record<ResourceId, number>;
  economy: EconomyState;
  delegates: Delegate[];
  nextDelegateId: number;
  /** Governors who have left, oldest first. */
  formerStaff: FormerGovernor[];
  decrees: Record<string, Decree>;
  labor: LaborState;
  desk: DeskState;
  crown: CrownState;
  illusion: IllusionState;
};

export type GameState = {
  schemaVersion: number;
  tick: number;
  career: CareerState;
  posting: PostingState;
};

/** Every stream the systems draw from; each is seeded at creation so no system seeds lazily mid-run. */
export const RNG_STREAMS = ["disputes", "names", "crown", "governors"] as const;
