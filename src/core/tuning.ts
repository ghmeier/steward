import { type Condition, type DecreeLimits, parseCondition } from "./decree";
import { RESOURCES, SEASONS, WORKING_JOBS } from "./realm";
import {
  array,
  custom,
  type Infer,
  integer,
  keyedBy,
  literal,
  number,
  object,
  parse,
  record,
  refine,
  type Schema,
  string,
} from "./schema";
import {
  ARCHIVE_PANEL,
  type ArchiveEntry,
  type ArchiveTuning,
  CHAINING_UNLOCK,
  COMPOUND_UNLOCK,
  type NeedHook,
  type PlayUnlock,
} from "./unlocks";

const nonNegative = number({ min: 0 });
const positive = number({ exclusiveMin: 0 });
const positiveInteger = integer({ min: 1 });
const name = string({ nonEmpty: true });

const placeholderText = refine(name, (text, path, problems) => {
  for (const match of text.matchAll(/\{([^{}]*)\}/g)) {
    if (match[1] !== "first" && match[1] !== "second") {
      problems.push(`${path}: has unknown placeholder ${match[0]}`);
    }
  }
});

const decreeLimits: Schema<DecreeLimits> = object({
  maxRules: positiveInteger,
  maxConditionNodes: positiveInteger,
  maxConditionDepth: positiveInteger,
});

const laborAllocations = refine(
  record(
    refine(keyedBy(WORKING_JOBS, nonNegative), (shares, path, problems) => {
      let total = 0;
      for (const job of WORKING_JOBS) total += shares[job];
      if (Math.abs(total - 1) > 1e-9) {
        problems.push(`${path}: shares must sum to 1`);
      }
    }),
  ),
  (allocations, path, problems) => {
    if (Object.keys(allocations).length === 0) {
      problems.push(`${path}: must not be empty`);
    }
  },
);

const economy = refine(
  object({
    ticksPerSeason: positiveInteger,
    seasonYield: keyedBy(SEASONS, nonNegative),
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
    initialPopulation: integer({ min: 0 }),
    initialResources: keyedBy(RESOURCES, nonNegative),
    laborAllocations,
  }),
  (value, path, problems) => {
    if (value.initialPopulation > value.maxPopulation) {
      problems.push(`${path}.initialPopulation: must not exceed maxPopulation`);
    }
  },
);

const disputeOption = object(
  {
    id: name,
    label: placeholderText,
    resources: object(
      {
        coin: number(),
        grain: number(),
        ore: number(),
        wood: number(),
      },
      { optional: RESOURCES },
    ),
    grudge: literal("first", "second"),
  },
  { optional: ["resources", "grudge"] },
);

const disputeTemplate = refine(
  object({
    id: name,
    text: placeholderText,
    options: array(disputeOption, { minLength: 2 }),
    expiry: string(),
  }),
  (template, path, problems) => {
    const seen = new Set<string>();
    for (const option of template.options) {
      if (seen.has(option.id)) {
        problems.push(`${path}.options: repeats option id "${option.id}"`);
      }
      seen.add(option.id);
    }
    const expiry = template.options.find(
      (option) => option.id === template.expiry,
    );
    if (expiry === undefined) {
      problems.push(`${path}.expiry: must name one of its options`);
      return;
    }
    if (expiry.grudge !== undefined) {
      problems.push(`${path}.expiry: option "${expiry.id}" must not grudge`);
    }
    for (const resource of RESOURCES) {
      if ((expiry.resources?.[resource] ?? 0) > 0) {
        problems.push(
          `${path}.expiry: option "${expiry.id}" must not gain ${resource}`,
        );
      }
    }
  },
);

function checkRepeats(
  items: readonly string[],
  path: string,
  problems: string[],
  label: string,
): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item)) problems.push(`${path}: repeats ${label} "${item}"`);
    seen.add(item);
  }
}

const village = object({
  names: refine(array(name), (names, path, problems) =>
    checkRepeats(names, path, problems, "name"),
  ),
  deskSlots: positiveInteger,
  promotionPopulation: positiveInteger,
  disputeArrival: refine(
    object({ minTicks: positiveInteger, maxTicks: positiveInteger }),
    (arrival, path, problems) => {
      if (arrival.minTicks > arrival.maxTicks) {
        problems.push(`${path}.minTicks: must not exceed maxTicks`);
      }
    },
  ),
  grudgeTicks: positiveInteger,
  disputes: refine(
    array(disputeTemplate, { minLength: 1 }),
    (templates, path, problems) =>
      checkRepeats(
        templates.map((template) => template.id),
        path,
        problems,
        "id",
      ),
  ),
});

const simpleCondition: Schema<Condition> = custom((value, path) => {
  const condition = parseCondition(
    value,
    { maxRules: 1, maxConditionNodes: 8, maxConditionDepth: 3 },
    path,
  );
  if (condition.kind !== "compare" && condition.kind !== "season") {
    throw new Error(`${path}: must be a compare or season condition`);
  }
  return condition;
});

const archiveEntry: Schema<ArchiveEntry> = object({
  id: name,
  label: name,
  description: name,
  cost: positive,
  requires: array(name),
});
const playUnlock: Schema<PlayUnlock> = object({
  id: name,
  label: name,
  when: simpleCondition,
});
const needHook: Schema<NeedHook> = object({
  control: name,
  when: simpleCondition,
});

function checkArchive(
  archive: ArchiveTuning,
  path: string,
  problems: string[],
): void {
  const { entries, play, needs } = archive;
  for (const id of [COMPOUND_UNLOCK, CHAINING_UNLOCK]) {
    if (!entries.some((entry) => entry.id === id)) {
      problems.push(`${path}.entries: must include "${id}"`);
    }
  }
  if (!play.some((unlock) => unlock.id === ARCHIVE_PANEL)) {
    problems.push(`${path}.play: must include "${ARCHIVE_PANEL}"`);
  }
  checkRepeats(
    [...entries.map((entry) => entry.id), ...play.map((unlock) => unlock.id)],
    path,
    problems,
    "id",
  );
  checkRepeats(
    needs.map((hook) => hook.control),
    `${path}.needs`,
    problems,
    "control",
  );

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  for (const entry of entries) {
    for (const required of entry.requires) {
      if (!byId.has(required)) {
        problems.push(
          `${path}.entries: "${entry.id}" requires unknown id "${required}"`,
        );
      }
    }
  }
  const done = new Set<string>();
  const visit = (id: string, trail: string[]): void => {
    if (trail.includes(id)) {
      problems.push(
        `${path}.entries: requires cycle ${[...trail, id].join(" -> ")}`,
      );
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

const archive: Schema<ArchiveTuning> = refine(
  object({
    maxSaved: positiveInteger,
    entries: array(archiveEntry),
    play: array(playUnlock),
    needs: array(needHook),
  }),
  checkArchive,
);

const tuningSchema = refine(
  object({
    stepMs: positive,
    maxResourceValue: positive,
    decrees: decreeLimits,
    economy,
    village,
    archive,
  }),
  (tuning, path, problems) => {
    const max = tuning.economy.maxPopulation;
    if (tuning.village.names.length < max) {
      problems.push(
        `${path}.village.names: needs at least maxPopulation (${max}) names, got ${tuning.village.names.length}`,
      );
    }
    if (tuning.village.promotionPopulation > max) {
      problems.push(
        `${path}.village.promotionPopulation: must not exceed economy.maxPopulation (${max})`,
      );
    }
  },
);

export type Tuning = Infer<typeof tuningSchema>;
export type VillageTuning = Infer<typeof village>;
export type DisputeTemplate = Infer<typeof disputeTemplate>;
export type DisputeOption = Infer<typeof disputeOption>;

/** Takes the merged contents of tuning.json, village.json and archive.json. */
export function parseTuning(value: unknown): Tuning {
  return parse(tuningSchema, value, "tuning");
}
