import type { Tuning } from "./tuning";

/** Picks from the seed rather than a random call, so the same seed always founds the same village name. */
export function defaultVillageName(seed: number, tuning: Tuning): string {
  const { villageNames } = tuning.village;
  return villageNames[seed % villageNames.length] as string;
}
