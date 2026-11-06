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

/** Every kind of event that can wait on the desk; a record keyed by kind is in this order. */
export const DESK_KINDS = ["dispute", "merchant", "traveller"] as const;
export type DeskKind = (typeof DESK_KINDS)[number];
