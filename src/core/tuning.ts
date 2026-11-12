import { z } from "zod";
import { crownTuningSchema } from "./crown";
import { decreeLimitsSchema } from "./decree";
import { deskTuningSchema } from "./desk-tuning";
import { economyTuningSchema, villageTuningSchema } from "./economy";
import { addIssue, parseWith } from "./errors";
import { governorTuningSchema } from "./governors";
import { illusionTuningSchema } from "./illusion";
import { positive } from "./schema";
import { archiveTuningSchema } from "./unlocks";

const tuningSchema = z
  .strictObject({
    stepMs: positive,
    maxResourceValue: positive,
    decrees: decreeLimitsSchema,
    economy: economyTuningSchema,
    village: villageTuningSchema,
    desk: deskTuningSchema,
    archive: archiveTuningSchema,
    crown: crownTuningSchema,
    illusion: illusionTuningSchema,
    governors: governorTuningSchema,
  })
  .superRefine((tuning, ctx) => {
    // Governors and open candidates are named from the same pool as peasants.
    const max =
      tuning.economy.maxPopulation + tuning.governors.cap + tuning.desk.slots;
    if (tuning.village.names.length < max) {
      addIssue(
        ctx,
        `needs at least maxPopulation plus the governor cap plus the desk slots (${max}) names, got ${tuning.village.names.length}`,
        ["village", "names"],
      );
    }
    if (tuning.village.promotionPopulation > tuning.economy.maxPopulation) {
      addIssue(
        ctx,
        `must not exceed economy.maxPopulation (${tuning.economy.maxPopulation})`,
        ["village", "promotionPopulation"],
      );
    }
  });

export type Tuning = z.infer<typeof tuningSchema>;

/** Takes the merged contents of tuning.json, village.json, desk.json, archive.json, crown.json, illusion.json and governors.json. */
export function parseTuning(value: unknown): Tuning {
  return parseWith(tuningSchema, value, "tuning");
}
