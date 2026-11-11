// Each list is in sorted key order, so iterating it is iterating a record in key order.
export const RESOURCES = ["coin", "grain", "ore", "wood"] as const;
export type Resource = (typeof RESOURCES)[number];

export enum Job {
  FARM = "farm",
  FOREST = "forest",
  MINE = "mine",
  IDLE = "idle",
}
export const JOBS = [Job.FARM, Job.FOREST, Job.MINE, Job.IDLE] as const;

/** The jobs a labor allocation divides the village between; idle is whatever is left over. */
export const WORKING_JOBS = [Job.FARM, Job.FOREST, Job.MINE] as const;
export type WorkingJob = (typeof WORKING_JOBS)[number];

// Calendar order, not key order: a season's index is its position in the year.
export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export type Season = (typeof SEASONS)[number];

/** In sorted order, so a record keyed by trait is walked in a fixed order. */
export const TRAITS = [
  "braggart",
  "diligent",
  "empire-builder",
  "hoarder",
  "skimmer",
] as const;
export type Trait = (typeof TRAITS)[number];
