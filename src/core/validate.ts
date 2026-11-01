import { sortedKeys } from "./data";
import { type Decree, decreeSchema, decreeSetProblem } from "./decree";
import { JOBS, RESOURCES } from "./realm";
import {
  array,
  integer,
  literal,
  number,
  object,
  record,
  refine,
  type Schema,
  string,
  tuple,
} from "./schema";
import { type GameState, type PostingState, SCHEMA_VERSION } from "./state";

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "object") {
    const name = Object.getPrototypeOf(value)?.constructor?.name;
    return typeof name === "string" ? name : "object";
  }
  return typeof value;
}

function scanPlainData(value: unknown, path: string, problems: string[]): void {
  if (value === undefined || value === null) {
    problems.push(`${path}: ${describe(value)} is not allowed`);
  } else if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      problems.push(`${path}: ${value} is not a finite number`);
    } else if (Object.is(value, -0)) {
      problems.push(`${path}: negative zero is not allowed`);
    }
  } else if (typeof value === "string" || typeof value === "boolean") {
    return;
  } else if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      problems.push(`${path}: array subclass is not plain data`);
    }
    for (let i = 0; i < value.length; i++) {
      if (!Object.hasOwn(value, i)) {
        problems.push(`${path}[${i}]: sparse array hole`);
      } else {
        scanPlainData(value[i], `${path}[${i}]`, problems);
      }
    }
  } else if (typeof value === "object") {
    if (!isPlainObject(value)) {
      problems.push(`${path}: ${describe(value)} is not a plain object`);
      return;
    }
    for (const key of sortedKeys(value)) {
      scanPlainData(
        (value as Record<string, unknown>)[key],
        `${path}.${key}`,
        problems,
      );
    }
  } else {
    problems.push(`${path}: ${typeof value} is not allowed`);
  }
}

const count = integer({ min: 0 });
const positiveCount = integer({ min: 1 });
const uint32 = integer({ min: 0, max: 0xffffffff });

const rngStream = refine(
  tuple(uint32, uint32, uint32, uint32),
  (words, path, problems) => {
    if (words.every((word) => word === 0)) {
      problems.push(`${path}: must not be all zero`);
    }
  },
);

const delegate = object({
  id: positiveCount,
  name: string({ nonEmpty: true }),
  kind: literal("peasant"),
  job: literal(...JOBS),
  grudgeUntil: count,
});

const dispute = object({
  id: positiveCount,
  template: string({ nonEmpty: true }),
  parties: tuple(positiveCount, positiveCount),
  arrivedAt: count,
});

function ascendingIdProblems(
  items: readonly { id: number }[],
  next: number,
  nextName: string,
  path: string,
  problems: string[],
): void {
  let previousId = 0;
  for (const [index, { id }] of items.entries()) {
    if (id <= previousId) {
      problems.push(`${path}[${index}].id: ids must be strictly ascending`);
    }
    if (id >= next) {
      problems.push(`${path}[${index}].id: must be below ${nextName}`);
    }
    previousId = id;
  }
}

const desk = refine(
  object({
    nextDisputeId: positiveCount,
    nextArrivalTick: count,
    disputes: array(dispute),
  }),
  (value, path, problems) =>
    ascendingIdProblems(
      value.disputes,
      value.nextDisputeId,
      "nextDisputeId",
      `${path}.disputes`,
      problems,
    ),
);

// Validation has no tuning, so the size caps are enforced when a decree is enacted, not here.
const UNBOUNDED_DECREE = {
  maxRules: Number.MAX_SAFE_INTEGER,
  maxConditionNodes: Number.MAX_SAFE_INTEGER,
  maxConditionDepth: Number.MAX_SAFE_INTEGER,
};

/** A decree lives under its own id; `decrees` also rejects sets that could never run. */
function decreeRecord(
  requireRunnableSet: boolean,
): Schema<Record<string, Decree>> {
  return refine(
    record(decreeSchema(UNBOUNDED_DECREE)),
    (decrees, path, problems) => {
      const before = problems.length;
      for (const key of sortedKeys(decrees)) {
        if (decrees[key]?.id !== key) {
          problems.push(`${path}.${key}: id must equal its key`);
        }
      }
      if (!requireRunnableSet || problems.length > before) return;
      // Labor policies need tuning, so only enacting checks them; loading cannot.
      const problem = decreeSetProblem(decrees, null);
      if (problem !== null) problems.push(`${path}: ${problem}`);
    },
  );
}

function rosterProblems(
  posting: PostingState,
  path: string,
  problems: string[],
): void {
  ascendingIdProblems(
    posting.delegates,
    posting.nextDelegateId,
    "nextDelegateId",
    `${path}.delegates`,
    problems,
  );
  const names = new Set<string>();
  for (const [index, { name }] of posting.delegates.entries()) {
    if (names.has(name)) {
      problems.push(
        `${path}.delegates[${index}].name: "${name}" is held by another peasant`,
      );
    }
    names.add(name);
  }

  const living = new Set(posting.delegates.map(({ id }) => id));
  for (const [index, { parties }] of posting.desk.disputes.entries()) {
    const [first, second] = parties;
    if (first === second || !living.has(first) || !living.has(second)) {
      problems.push(
        `${path}.desk.disputes[${index}].parties: must be two distinct peasants in the roster`,
      );
    }
  }
}

function tickBoundProblems(
  state: GameState,
  path: string,
  problems: string[],
): void {
  if (state.career.promotedAt > state.tick) {
    problems.push(`${path}.career.promotedAt: must not exceed tick`);
  }
  for (const [index, { arrivedAt }] of state.posting.desk.disputes.entries()) {
    if (arrivedAt > state.tick) {
      problems.push(
        `${path}.posting.desk.disputes[${index}].arrivedAt: must be no later than the tick`,
      );
    }
  }
}

const resources = refine(record(number()), (amounts, path, problems) => {
  for (const id of RESOURCES) {
    if (!Object.hasOwn(amounts, id)) problems.push(`${path}.${id}: is missing`);
  }
});

const posting: Schema<PostingState> = refine(
  object({
    postingId: string(),
    seed: uint32,
    rng: record(rngStream),
    resources,
    economy: object({
      famine: object({
        startPopulation: count,
        ticks: count,
        deaths: count,
      }),
      growth: number({ min: 0 }),
      starved: count,
    }),
    delegates: array(delegate),
    nextDelegateId: positiveCount,
    decrees: decreeRecord(true),
    desk,
  }),
  rosterProblems,
);

const career = object({
  unlocks: record(count),
  savedDecrees: decreeRecord(false),
  needed: record(count),
  followers: array(string()),
  formerStaff: array(string()),
  promotedAt: count,
});

const gameState: Schema<GameState> = refine(
  object({
    schemaVersion: refine(integer(), (version, path, problems) => {
      if (version !== SCHEMA_VERSION) {
        problems.push(`${path}: must be ${SCHEMA_VERSION}`);
      }
    }),
    tick: count,
    career,
    posting,
  }),
  tickBoundProblems,
);

export function validateState(state: unknown): string[] {
  const problems: string[] = [];
  scanPlainData(state, "$", problems);
  gameState.check(state, "$", problems);
  return problems;
}

export function assertValidState(state: unknown): asserts state is GameState {
  const problems = validateState(state);
  if (problems.length > 0) {
    throw new Error(`invalid game state:\n${problems.join("\n")}`);
  }
}
