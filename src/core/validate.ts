import { z } from "zod";
import { sortedKeys } from "./data";
import { type Decree, decreeSchema, decreeSetProblem } from "./decree";
import { DRAWN_KINDS } from "./desk";
import { addIssue, formatIssue } from "./errors";
import { NO_AUDIT_TICK } from "./illusion";
import { JOBS, RESOURCES } from "./realm";
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

const count = z.int().min(0);
const positiveCount = z.int().min(1);
const uint32 = z.int().min(0).max(0xffffffff);

const rngStream = z
  .tuple([uint32, uint32, uint32, uint32])
  .superRefine((words, ctx) => {
    if (words.every((word) => word === 0)) {
      addIssue(ctx, "must not be all zero");
    }
  });

const delegate = z.strictObject({
  id: positiveCount,
  name: z.string().min(1),
  kind: z.literal("peasant"),
  job: z.enum(JOBS),
  grudgeUntil: count,
});

const deskEntryBase = {
  id: positiveCount,
  template: z.string().min(1),
  arrivedAt: count,
};

const deskEntry = z.discriminatedUnion("kind", [
  z.strictObject({
    ...deskEntryBase,
    kind: z.literal("dispute"),
    parties: z.tuple([positiveCount, positiveCount]),
  }),
  z.strictObject({
    ...deskEntryBase,
    kind: z.enum(DRAWN_KINDS).exclude(["dispute"]),
  }),
  z.strictObject({ ...deskEntryBase, kind: z.literal("audit"), dueAt: count }),
]);

const demand = z.strictObject({
  id: count,
  resource: z.string(),
  amount: z.number().min(0),
  delivered: z.number().min(0),
  issuedAt: count,
  dueAt: count,
});

const crown = z.strictObject({
  demand,
  nextDemandTick: count,
  met: count,
  missed: count,
  surcharge: z.number().min(0),
  lastResource: z.string(),
});

const nonNegativeNumber = z.number().min(0);

const illusion = z.strictObject({
  conjured: z.strictObject({
    coin: nonNegativeNumber,
    grain: nonNegativeNumber,
  }),
  debt: z.strictObject({
    coin: nonNegativeNumber,
    grain: nonNegativeNumber,
    ore: nonNegativeNumber,
    wood: nonNegativeNumber,
  }),
  debtSince: count,
  auditAt: count,
  audits: z.strictObject({ backed: count, deepened: count, failed: count }),
});

function ascendingIdIssues<List extends string, Next extends string>(
  ctx: z.RefinementCtx,
  parent: Record<List, readonly { id: number }[]> & Record<Next, number>,
  listKey: List,
  nextKey: Next,
): void {
  let previousId = 0;
  for (const [index, { id }] of parent[listKey].entries()) {
    const path = [listKey, index, "id"];
    if (id <= previousId) addIssue(ctx, "ids must be strictly ascending", path);
    if (id >= parent[nextKey]) addIssue(ctx, `must be below ${nextKey}`, path);
    previousId = id;
  }
}

const desk = z
  .strictObject({
    nextDisputeId: positiveCount,
    nextArrivalTick: count,
    disputes: z.array(deskEntry),
  })
  .superRefine((value, ctx) =>
    ascendingIdIssues(ctx, value, "disputes", "nextDisputeId"),
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
): z.ZodType<Record<string, Decree>> {
  return z
    .record(z.string(), decreeSchema(UNBOUNDED_DECREE))
    .superRefine((decrees, ctx) => {
      let idMismatch = false;
      for (const key of sortedKeys(decrees)) {
        if (decrees[key]?.id !== key) {
          idMismatch = true;
          addIssue(ctx, "id must equal its key", [key]);
        }
      }
      if (!requireRunnableSet || idMismatch) return;
      // Labor policies need tuning, so only enacting checks them; loading cannot.
      const problem = decreeSetProblem(decrees, null);
      if (problem !== null) addIssue(ctx, problem);
    });
}

function rosterIssues(posting: PostingState, ctx: z.RefinementCtx): void {
  ascendingIdIssues(ctx, posting, "delegates", "nextDelegateId");
  const names = new Set<string>();
  for (const [index, { name }] of posting.delegates.entries()) {
    if (names.has(name)) {
      addIssue(ctx, `"${name}" is held by another peasant`, [
        "delegates",
        index,
        "name",
      ]);
    }
    names.add(name);
  }

  const audits = posting.desk.disputes.filter(({ kind }) => kind === "audit");
  if (audits.length > 1) {
    addIssue(ctx, "must hold at most one audit", ["desk", "disputes"]);
  }

  const living = new Set(posting.delegates.map(({ id }) => id));
  for (const [index, entry] of posting.desk.disputes.entries()) {
    if (entry.kind !== "dispute") continue;
    const [first, second] = entry.parties;
    if (first === second || !living.has(first) || !living.has(second)) {
      addIssue(ctx, "must be two distinct peasants in the roster", [
        "desk",
        "disputes",
        index,
        "parties",
      ]);
    }
  }
}

function tickBoundIssues(state: GameState, ctx: z.RefinementCtx): void {
  if (state.career.promotedAt > state.tick) {
    addIssue(ctx, "must not exceed tick", ["career", "promotedAt"]);
  }
  if (state.posting.crown.demand.issuedAt > state.tick) {
    addIssue(ctx, "must be no later than the tick", [
      "posting",
      "crown",
      "demand",
      "issuedAt",
    ]);
  }
  if (state.posting.illusion.debtSince > state.tick) {
    addIssue(ctx, "must be no later than the tick", [
      "posting",
      "illusion",
      "debtSince",
    ]);
  }
  const { auditAt } = state.posting.illusion;
  if (auditAt !== NO_AUDIT_TICK && auditAt <= state.tick) {
    addIssue(ctx, "must be after the tick", ["posting", "illusion", "auditAt"]);
  }
  for (const [index, entry] of state.posting.desk.disputes.entries()) {
    if (entry.arrivedAt > state.tick) {
      addIssue(ctx, "must be no later than the tick", [
        "posting",
        "desk",
        "disputes",
        index,
        "arrivedAt",
      ]);
    }
    if (entry.kind === "audit" && entry.dueAt <= state.tick) {
      addIssue(ctx, "must be after the tick", [
        "posting",
        "desk",
        "disputes",
        index,
        "dueAt",
      ]);
    }
  }
}

const resources = z
  .record(z.string(), z.number())
  .superRefine((amounts, ctx) => {
    for (const id of RESOURCES) {
      if (!Object.hasOwn(amounts, id)) {
        addIssue(ctx, "is missing", [id]);
      }
    }
  });

const posting: z.ZodType<PostingState> = z
  .strictObject({
    postingId: z.string(),
    seed: uint32,
    rng: z.record(z.string(), rngStream),
    resources,
    economy: z.strictObject({
      famine: z.strictObject({
        startPopulation: count,
        ticks: count,
        deaths: count,
      }),
      growth: z.number().min(0),
      starved: count,
    }),
    delegates: z.array(delegate),
    nextDelegateId: positiveCount,
    decrees: decreeRecord(true),
    labor: z.strictObject({ policy: z.string(), settling: z.boolean() }),
    desk,
    crown,
    illusion,
  })
  .superRefine(rosterIssues);

const career = z.strictObject({
  unlocks: z.record(z.string(), count),
  savedDecrees: decreeRecord(false),
  needed: z.record(z.string(), count),
  followers: z.array(z.string()),
  formerStaff: z.array(z.string()),
  promotedAt: count,
});

const gameState: z.ZodType<GameState> = z
  .strictObject({
    schemaVersion: z.literal(SCHEMA_VERSION),
    tick: count,
    career,
    posting,
  })
  .superRefine(tickBoundIssues);

export function validateState(state: unknown): string[] {
  const problems: string[] = [];
  scanPlainData(state, "$", problems);
  const result = gameState.safeParse(state);
  if (!result.success) {
    problems.push(
      ...result.error.issues.map((issue) => formatIssue(issue, "$")),
    );
  }
  return problems;
}

export function assertValidState(state: unknown): asserts state is GameState {
  const problems = validateState(state);
  if (problems.length > 0) {
    throw new Error(`invalid game state:\n${problems.join("\n")}`);
  }
}
