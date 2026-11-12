import { z } from "zod";
import { type Condition, conditionSchema, type DecreeLimits } from "./decree";
import { addIssue, type IssuePath, parseWith } from "./errors";
import { normalizeZero } from "./math";
import { RESOURCES, SEASONS, TRAITS, WORKING_JOBS } from "./realm";
import {
  ARCHIVE_PANEL,
  type ArchiveEntry,
  type ArchiveTuning,
  DECREE_GATES,
  type NeedHook,
  type PlayUnlock,
} from "./unlocks";

const nonNegative = z.number().min(0).transform(normalizeZero);
const positive = z.number().gt(0).transform(normalizeZero);
const positiveInteger = z.int().min(1);
const name = z.string().min(1);

function textWithPlaceholders(allowed: readonly string[]) {
  return name.superRefine((text, ctx) => {
    for (const match of text.matchAll(/\{([^{}]*)\}/g)) {
      if (!allowed.includes(match[1] ?? "")) {
        addIssue(ctx, `has unknown placeholder ${match[0]}`);
      }
    }
  });
}

const amountText = textWithPlaceholders(["amount"]);

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
        addIssue(ctx, "shares must sum to 1");
      }
    }),
  )
  .superRefine((allocations, ctx) => {
    if (Object.keys(allocations).length === 0) {
      addIssue(ctx, "must not be empty");
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
      addIssue(ctx, "must not exceed maxPopulation", ["initialPopulation"]);
    }
  });

const amount = z.number().transform(normalizeZero).exactOptional();

const optionResources = z
  .strictObject({
    coin: amount,
    grain: amount,
    ore: amount,
    wood: amount,
  })
  .exactOptional();

const PARTY_PLACEHOLDERS = ["first", "second"];
const CANDIDATE_PLACEHOLDERS = ["name", "village", "price", "job", "traits"];
const NO_PLACEHOLDERS: string[] = [];

function deskOption(placeholders: readonly string[]) {
  return z.strictObject({
    id: name,
    label: textWithPlaceholders(placeholders),
    resources: optionResources,
  });
}

const disputeOption = deskOption(PARTY_PLACEHOLDERS).extend({
  grudge: z.enum(["first", "second"]).exactOptional(),
});

const merchantOption = deskOption(NO_PLACEHOLDERS);

const travellerOption = merchantOption.extend({
  newcomer: z.literal(true).exactOptional(),
});

const computedCostOption = <Id extends string>(
  id: Id,
  placeholders: readonly string[],
) =>
  z.strictObject({
    id: z.literal(id),
    label: textWithPlaceholders(placeholders),
    // Declared so every kind's option reads alike, but never allowed: the cost is computed from the entry or the books.
    resources: z.never().exactOptional(),
  });

const auditOption = <Id extends string>(id: Id) => computedCostOption(id, []);

const candidateOption = <Id extends string>(id: Id) =>
  computedCostOption(id, CANDIDATE_PLACEHOLDERS);

// Every kind's option is read through this one shape, so the fields only some kinds have are optional here.
export type DeskOption = z.infer<typeof merchantOption> &
  Partial<
    Pick<z.infer<typeof disputeOption>, "grudge"> &
      Pick<z.infer<typeof travellerOption>, "newcomer">
  >;

function deskTemplate(
  option: z.ZodType<DeskOption>,
  placeholders: readonly string[],
) {
  return z
    .strictObject({
      id: name,
      text: textWithPlaceholders(placeholders),
      options: z.array(option).min(2),
      expiry: z.string(),
      expired: textWithPlaceholders(placeholders),
    })
    .superRefine((template, ctx) => {
      repeatIssues(
        template.options.map((candidate) => candidate.id),
        "option id",
        ctx,
        ["options"],
      );
      const expiry = template.options.find(
        (candidate) => candidate.id === template.expiry,
      );
      if (expiry === undefined) {
        addIssue(ctx, "must name one of its options", ["expiry"]);
        return;
      }
      if (expiry.grudge !== undefined) {
        addIssue(ctx, `option "${expiry.id}" must not grudge`, ["expiry"]);
      }
      if (expiry.newcomer !== undefined) {
        addIssue(ctx, `option "${expiry.id}" must not add a peasant`, [
          "expiry",
        ]);
      }
      for (const resource of RESOURCES) {
        if ((expiry.resources?.[resource] ?? 0) > 0) {
          addIssue(ctx, `option "${expiry.id}" must not gain ${resource}`, [
            "expiry",
          ]);
        }
      }
    });
}

function deskKind(
  option: z.ZodType<DeskOption>,
  placeholders: readonly string[],
) {
  return z.strictObject({
    weight: positiveInteger,
    templates: z
      .array(deskTemplate(option, placeholders))
      .min(1)
      .superRefine((templates, ctx) =>
        repeatIssues(
          templates.map((template) => template.id),
          "id",
          ctx,
        ),
      ),
  });
}

// An audit's options cost whatever the debt is when it is settled, so the template holds no amounts, and
// it has no expiry option because failing the deadline is not something the player picks.
const auditTemplate = z.strictObject({
  id: name,
  text: textWithPlaceholders(NO_PLACEHOLDERS),
  options: z.tuple([auditOption("back"), auditOption("deepen")]),
  expired: textWithPlaceholders(NO_PLACEHOLDERS),
});

// A candidate's price is on the entry, so its options hold no amounts; the only way out without hiring is passing.
const candidateTemplate = z.strictObject({
  id: name,
  text: textWithPlaceholders(CANDIDATE_PLACEHOLDERS),
  options: z.tuple([candidateOption("hire"), candidateOption("pass")]),
  expiry: z.literal("pass"),
  expired: textWithPlaceholders(CANDIDATE_PLACEHOLDERS),
});

const candidateKind = z.strictObject({
  weight: positiveInteger,
  templates: z
    .array(candidateTemplate)
    .min(1)
    .superRefine((templates, ctx) =>
      repeatIssues(
        templates.map((template) => template.id),
        "id",
        ctx,
      ),
    ),
});

const auditKind = z.strictObject({
  templates: z
    .array(auditTemplate)
    .min(1)
    .superRefine((templates, ctx) =>
      repeatIssues(
        templates.map((template) => template.id),
        "id",
        ctx,
      ),
    ),
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
      addIssue(ctx, `repeats ${label} "${item}"`, path);
    }
    seen.add(item);
  }
}

const village = z.strictObject({
  names: z
    .array(name)
    .superRefine((names, ctx) => repeatIssues(names, "name", ctx)),
  promotionPopulation: positiveInteger,
});

const desk = z.strictObject({
  slots: positiveInteger,
  arrival: z
    .strictObject({ minTicks: positiveInteger, maxTicks: positiveInteger })
    .superRefine((arrival, ctx) => {
      if (arrival.minTicks > arrival.maxTicks) {
        addIssue(ctx, "must not exceed maxTicks", ["minTicks"]);
      }
    }),
  grudgeTicks: positiveInteger,
  kinds: z.strictObject({
    dispute: deskKind(disputeOption, PARTY_PLACEHOLDERS),
    merchant: deskKind(merchantOption, NO_PLACEHOLDERS),
    traveller: deskKind(travellerOption, NO_PLACEHOLDERS),
    candidate: candidateKind,
    audit: auditKind,
  }),
});

const countRange = z
  .strictObject({ min: positiveInteger, max: positiveInteger })
  .superRefine((range, ctx) => {
    if (range.min > range.max) addIssue(ctx, "must not exceed max", ["min"]);
  });

const tickRange = z
  .strictObject({ minTicks: positiveInteger, maxTicks: positiveInteger })
  .superRefine((range, ctx) => {
    if (range.minTicks > range.maxTicks) {
      addIssue(ctx, "must not exceed maxTicks", ["minTicks"]);
    }
  });

const governors = z.strictObject({
  cap: positiveInteger,
  village: countRange,
  term: tickRange,
  deathPerMille: z.int().min(0).max(1000),
  price: countRange,
  empireBuilderLimit: positiveInteger,
  traits: z.record(
    z.enum(TRAITS),
    z.strictObject({ output: positive, report: positive }),
  ),
});

const crownLines = z.strictObject({
  herald: amountText,
  met: amountText,
  missed: amountText,
});

const favor = z
  .strictObject({
    limit: positive,
    coldBelow: z.number(),
    warmAbove: z.number(),
    met: nonNegative,
    early: nonNegative,
    missed: z.number().max(0),
    backed: nonNegative,
    deepened: z.number().max(0),
    failed: z.number().max(0),
    cold: z.strictObject({
      debtShareFactor: positive,
      warningFactor: positive,
      stepFactor: positive,
    }),
    warm: z.strictObject({
      ceilingFactor: positive,
      rewardFactor: positive,
    }),
  })
  .superRefine((value, ctx) => {
    if (value.coldBelow >= value.warmAbove) {
      addIssue(ctx, "must be below warmAbove", ["coldBelow"]);
    }
  });

const crown = z.strictObject({
  firstDemandTicks: positiveInteger,
  deadlineTicks: positiveInteger,
  gap: z
    .strictObject({ minTicks: positiveInteger, maxTicks: positiveInteger })
    .superRefine((gap, ctx) => {
      if (gap.minTicks > gap.maxTicks) {
        addIssue(ctx, "must not exceed maxTicks", ["minTicks"]);
      }
    }),
  baseAmounts: z.record(z.enum(RESOURCES), positive),
  step: nonNegative,
  grainReserveSeasons: nonNegative,
  surcharge: nonNegative,
  reward: nonNegative,
  favor,
  lines: z.record(z.enum(RESOURCES), crownLines),
});

const illusion = z
  .strictObject({
    lot: positive,
    ceilingPerPeasant: positive,
    fadePerTick: z.number().min(0).max(1).transform(normalizeZero),
    interestPerTick: nonNegative,
    audit: z.strictObject({
      debtShare: positive,
      ageTicks: positiveInteger,
      warningTicks: positiveInteger,
      deadlineTicks: positiveInteger,
      deepenCost: nonNegative,
      deepenGrowth: z.number().min(1),
    }),
    books: z.strictObject({ strained: positive, rotten: positive }),
  })
  .superRefine((value, ctx) => {
    if (value.books.strained >= value.books.rotten) {
      addIssue(ctx, "must be below rotten", ["books", "strained"]);
    }
  });

const simpleCondition: z.ZodType<Condition> = conditionSchema({
  maxRules: 1,
  maxConditionNodes: 8,
  maxConditionDepth: 3,
}).superRefine((condition, ctx) => {
  if (condition.kind !== "compare" && condition.kind !== "season") {
    addIssue(ctx, "must be a compare or season condition");
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
  for (const { id } of DECREE_GATES) {
    if (!entries.some((entry) => entry.id === id)) {
      addIssue(ctx, `must include "${id}"`, ["entries"]);
    }
  }
  if (!play.some((unlock) => unlock.id === ARCHIVE_PANEL)) {
    addIssue(ctx, `must include "${ARCHIVE_PANEL}"`, ["play"]);
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
        addIssue(ctx, `"${entry.id}" requires unknown id "${required}"`, [
          "entries",
        ]);
      }
    }
  }
  const done = new Set<string>();
  const visit = (id: string, trail: string[]): void => {
    if (trail.includes(id)) {
      addIssue(ctx, `requires cycle ${[...trail, id].join(" -> ")}`, [
        "entries",
      ]);
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
    desk,
    archive,
    crown,
    illusion,
    governors,
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
export type VillageTuning = z.infer<typeof village>;
export type DeskTuning = z.infer<typeof desk>;
export type GovernorTuning = z.infer<typeof governors>;
export type DeskTemplate = Omit<
  z.infer<ReturnType<typeof deskTemplate>>,
  "expiry"
> & { expiry?: string };

/** Takes the merged contents of tuning.json, village.json, desk.json, archive.json, crown.json, illusion.json and governors.json. */
export function parseTuning(value: unknown): Tuning {
  return parseWith(tuningSchema, value, "tuning");
}
