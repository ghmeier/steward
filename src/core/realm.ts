// Each list is in sorted key order, so iterating it is iterating a record in key order.
export const RESOURCES = ["coin", "grain", "ore", "wood"] as const;
export type Resource = (typeof RESOURCES)[number];

export const JOBS = ["farm", "forest", "mine"] as const;
export type Job = (typeof JOBS)[number];

// Calendar order, not key order: a season's index is its position in the year.
export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export type Season = (typeof SEASONS)[number];
