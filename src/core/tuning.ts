import { z } from "zod";
import { type Condition, conditionSchema, type DecreeLimits } from "./decree";
import { parseWith } from "./errors";
import { normalizeZero } from "./math";
import { RESOURCES, SEASONS, WORKING_JOBS } from "./realm";
import {
  ARCHIVE_PANEL,
  type ArchiveEntry,
  type ArchiveTuning,
  CHAINING_UNLOCK,
  COMPOUND_UNLOCK,
  type NeedHook,
  type PlayUnlock,
} from "./unlocks";

const nonNegative = z.number().min(0).transform(normalizeZero);
const positive = z.number().gt(0).transform(normalizeZero);
const positiveInteger = z.int().min(1);
const name = z.string().min(1);

type IssuePath = (string | number)[];

const placeholderText = name.superRefine((text, ctx) => {
  for (const match of text.matchAll(/\{([^{}]*)\}/g)) {
    if (match[1] !== "first" && match[1] !== "second") {
      ctx.addIssue({
        code: "custom",
        message: `has unknown placeholder ${match[0]}`,
      });
    }
  }
});

const decreeLimits: z.ZodType<DecreeLimits> = z.strictObject({
  maxRules: positiveInteger,
  maxConditionNodes: positiveInteger,
  maxConditionDepth: positiveInteger,
});

const laborAllocations = z
  .record(
    z.string(),
    z.record(z.enum(WORKING_JOBS), nonNegative).superRefine((shares, ctx) => {
      let total = 0;
      for (const job of WORKING_JOBS) total += shares[job];
      if (Math.abs(total - 1) > 1e-9) {
        ctx.addIssue({ code: "custom", message: "shares must sum to 1" });
      }
    }),
  )
  .superRefine((allocations, ctx) => {
    if (Object.keys(allocations).length === 0) {
      ctx.addIssue({ code: "custom", message: "must not be empty" });
    }
  });

const economy = z
  .strictObject({
    ticksPerSeason: positiveInteger,
    seasonYield: z.record(z.enum(SEASONS), nonNegative),
    grainPerFarmer: nonNegative,
    woodPerWorker: nonNegative,
    orePerWorker: nonNegative,
    grainPerPerson: nonNegative,
    grainPrice: nonNegative,
    woodPrice: nonNegative,
    orePrice: nonNegative,
    grainPerPeasant: positive,
    maxPopulation: positiveInteger,
    laborMovesPerTick: positiveInteger,
    initialPopulation: z.int().min(0),
    initialResources: z.record(z.enum(RESOURCES), nonNegative),
    laborAllocations,
  })
  .superRefine((value, ctx) => {
    if (value.initialPopulation > value.maxPopulation) {
      ctx.addIssue({
        code: "custom",
        message: "must not exceed maxPopulation",
        path: ["initialPopulation"],
      });
    }
  });

const amount = z.number().transform(normalizeZero).exactOptional();

const disputeOption = z.strictObject({
  id: name,
  label: placeholderText,
  resources: z
    .strictObject({
      coin: amount,
      grain: amount,
      ore: amount,
      wood: amount,
    })
    .exactOptional(),
  grudge: z.enum(["first", "second"]).exactOptional(),
});

const disputeTemplate = z
  .strictObject({
    id: name,
    text: placeholderText,
    options: z.array(disputeOption).min(2),
    expiry: z.string(),
  })
  .superRefine((template, ctx) => {
    const seen = new Set<string>();
    for (const option of template.options) {
      if (seen.has(option.id)) {
        ctx.addIssue({
          code: "custom",
          message: `repeats option id "${option.id}"`,
          path: ["options"],
        });
      }
      seen.add(option.id);
    }
    const expiry = template.options.find(
      (option) => option.id === template.expiry,
    );
    if (expiry === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "must name one of its options",
        path: ["expiry"],
      });
      return;
    }
    if (expiry.grudge !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: `option "${expiry.id}" must not grudge`,
        path: ["expiry"],
      });
    }
    for (const resource of RESOURCES) {
      if ((expiry.resources?.[resource] ?? 0) > 0) {
        ctx.addIssue({
          code: "custom",
          message: `option "${expiry.id}" must not gain ${resource}`,
          path: ["expiry"],
        });
      }
    }
  });

function repeatIssues(
  items: readonly string[],
  label: string,
  ctx: z.RefinementCtx,
  path: IssuePath = [],
): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item)) {
      ctx.addIssue({
        code: "custom",
        message: `repeats ${label} "${item}"`,
        path,
      });
    }
    seen.add(item);
  }
}

const village = z.strictObject({
  names: z
    .array(name)
    .superRefine((names, ctx) => repeatIssues(names, "name", ctx)),
  deskSlots: positiveInteger,
  promotionPopulation: positiveInteger,
  disputeArrival: z
    .strictObject({ minTicks: positiveInteger, maxTicks: positiveInteger })
    .superRefine((arrival, ctx) => {
      if (arrival.minTicks > arrival.maxTicks) {
        ctx.addIssue({
          code: "custom",
          message: "must not exceed maxTicks",
          path: ["minTicks"],
        });
      }
    }),
  grudgeTicks: positiveInteger,
  disputes: z
    .array(disputeTemplate)
    .min(1)
    .superRefine((templates, ctx) =>
      repeatIssues(
        templates.map((template) => template.id),
        "id",
        ctx,
      ),
    ),
});

const simpleCondition: z.ZodType<Condition> = conditionSchema({
  maxRules: 1,
  maxConditionNodes: 8,
  maxConditionDepth: 3,
}).superRefine((condition, ctx) => {
  if (condition.kind !== "compare" && condition.kind !== "season") {
    ctx.addIssue({
      code: "custom",
      message: "must be a compare or season condition",
    });
  }
});

const archiveEntry: z.ZodType<ArchiveEntry> = z.strictObject({
  id: name,
  label: name,
  description: name,
  cost: positive,
  requires: z.array(name),
});
const playUnlock: z.ZodType<PlayUnlock> = z.strictObject({
  id: name,
  label: name,
  when: simpleCondition,
});
const needHook: z.ZodType<NeedHook> = z.strictObject({
  control: name,
  when: simpleCondition,
});

function archiveIssues(archive: ArchiveTuning, ctx: z.RefinementCtx): void {
  const { entries, play, needs } = archive;
  for (const id of [COMPOUND_UNLOCK, CHAINING_UNLOCK]) {
    if (!entries.some((entry) => entry.id === id)) {
      ctx.addIssue({
        code: "custom",
        message: `must include "${id}"`,
        path: ["entries"],
      });
    }
  }
  if (!play.some((unlock) => unlock.id === ARCHIVE_PANEL)) {
    ctx.addIssue({
      code: "custom",
      message: `must include "${ARCHIVE_PANEL}"`,
      path: ["play"],
    });
  }
  repeatIssues(
    [...entries.map((entry) => entry.id), ...play.map((unlock) => unlock.id)],
    "id",
    ctx,
  );
  repeatIssues(
    needs.map((hook) => hook.control),
    "control",
    ctx,
    ["needs"],
  );

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  for (const entry of entries) {
    for (const required of entry.requires) {
      if (!byId.has(required)) {
        ctx.addIssue({
          code: "custom",
          message: `"${entry.id}" requires unknown id "${required}"`,
          path: ["entries"],
        });
      }
    }
  }
  const done = new Set<string>();
  const visit = (id: string, trail: string[]): void => {
    if (trail.includes(id)) {
      ctx.addIssue({
        code: "custom",
        message: `requires cycle ${[...trail, id].join(" -> ")}`,
        path: ["entries"],
      });
      return;
    }
    if (done.has(id)) return;
    for (const required of byId.get(id)?.requires ?? []) {
      visit(required, [...trail, id]);
    }
    done.add(id);
  };
  for (const entry of entries) visit(entry.id, []);
}

const archive: z.ZodType<ArchiveTuning> = z
  .strictObject({
    maxSaved: positiveInteger,
    entries: z.array(archiveEntry),
    play: z.array(playUnlock),
    needs: z.array(needHook),
  })
  .superRefine(archiveIssues);

const tuningSchema = z
  .strictObject({
    stepMs: positive,
    maxResourceValue: positive,
    decrees: decreeLimits,
    economy,
    village,
    archive,
  })
  .superRefine((tuning, ctx) => {
    const max = tuning.economy.maxPopulation;
    if (tuning.village.names.length < max) {
      ctx.addIssue({
        code: "custom",
        message: `needs at least maxPopulation (${max}) names, got ${tuning.village.names.length}`,
        path: ["village", "names"],
      });
    }
    if (tuning.village.promotionPopulation > max) {
      ctx.addIssue({
        code: "custom",
        message: `must not exceed economy.maxPopulation (${max})`,
        path: ["village", "promotionPopulation"],
      });
    }
  });

export type Tuning = z.infer<typeof tuningSchema>;
export type VillageTuning = z.infer<typeof village>;
export type DisputeTemplate = z.infer<typeof disputeTemplate>;
export type DisputeOption = z.infer<typeof disputeOption>;

/** Takes the merged contents of tuning.json, village.json and archive.json. */
export function parseTuning(value: unknown): Tuning {
  return parseWith(tuningSchema, value, "tuning");
}
