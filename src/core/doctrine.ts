import { z } from "zod";
import { addIssue } from "./errors";
import { name, nonNegative, repeatIssues } from "./schema";
import { type ArchiveEffects, archiveEffectsSchema } from "./unlocks";

/** The doctrines whose rule the game's code acts on; the data may rename and retune them but not drop one. */
export const TRADE = "trade";
export const AGRICULTURE = "agriculture";
export const EXTRACTION = "extraction";
const RULED_DOCTRINES = [TRADE, AGRICULTURE, EXTRACTION] as const;

export type Doctrine = {
  id: string;
  label: string;
  /** The rule the doctrine adds to the modifiers it changes. */
  rule: { label: string; description: string };
  effects: ArchiveEffects;
};

const doctrine: z.ZodType<Doctrine> = z.strictObject({
  id: name,
  label: name,
  rule: z.strictObject({ label: name, description: name }),
  effects: archiveEffectsSchema,
});

export const doctrineTuningSchema = z
  .strictObject({
    /** The share of a season's mined ore that an extraction posting is paid in coin when the season ends. */
    prospectingShare: nonNegative,
    entries: z.array(doctrine),
  })
  .superRefine((value, ctx) => {
    const ids = value.entries.map(({ id }) => id);
    repeatIssues(ids, "doctrine id", ctx, ["entries"]);
    for (const id of RULED_DOCTRINES) {
      if (!ids.includes(id)) {
        addIssue(ctx, `must include "${id}"`, ["entries"]);
      }
    }
  });

export type DoctrineTuning = z.infer<typeof doctrineTuningSchema>;
