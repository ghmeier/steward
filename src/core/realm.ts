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

// Calendar order, not key order: a season's index is its position in the year.
export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export type Season = (typeof SEASONS)[number];
