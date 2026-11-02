import { z } from "zod";
import { sortedKeys } from "./data";
import { type Decree, decreeSchema, decreeSetProblem } from "./decree";
import { formatIssue } from "./errors";
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

type IssuePath = (string | number)[];

const rngStream = z
  .tuple([uint32, uint32, uint32, uint32])
  .superRefine((words, ctx) => {
    if (words.every((word) => word === 0)) {
      ctx.addIssue({ code: "custom", message: "must not be all zero" });
    }
  });

const delegate = z.strictObject({
  id: positiveCount,
  name: z.string().min(1),
  kind: z.literal("peasant"),
  job: z.enum(JOBS),
  grudgeUntil: count,
});

const dispute = z.strictObject({
  id: positiveCount,
  template: z.string().min(1),
  parties: z.tuple([positiveCount, positiveCount]),
  arrivedAt: count,
});

function ascendingIdIssues(
  items: readonly { id: number }[],
  next: number,
  nextName: string,
  path: IssuePath,
  ctx: z.RefinementCtx,
): void {
  let previousId = 0;
  for (const [index, { id }] of items.entries()) {
    if (id <= previousId) {
      ctx.addIssue({
        code: "custom",
        message: "ids must be strictly ascending",
        path: [...path, index, "id"],
      });
    }
    if (id >= next) {
      ctx.addIssue({
        code: "custom",
        message: `must be below ${nextName}`,
        path: [...path, index, "id"],
      });
    }
    previousId = id;
  }
}

const desk = z
  .strictObject({
    nextDisputeId: positiveCount,
    nextArrivalTick: count,
    disputes: z.array(dispute),
  })
  .superRefine((value, ctx) =>
    ascendingIdIssues(
      value.disputes,
      value.nextDisputeId,
      "nextDisputeId",
      ["disputes"],
      ctx,
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
): z.ZodType<Record<string, Decree>> {
  return z
    .record(z.string(), decreeSchema(UNBOUNDED_DECREE))
    .superRefine((decrees, ctx) => {
      let idMismatch = false;
      for (const key of sortedKeys(decrees)) {
        if (decrees[key]?.id !== key) {
          idMismatch = true;
          ctx.addIssue({
            code: "custom",
            message: "id must equal its key",
            path: [key],
          });
        }
      }
      if (!requireRunnableSet || idMismatch) return;
      // Labor policies need tuning, so only enacting checks them; loading cannot.
      const problem = decreeSetProblem(decrees, null);
      if (problem !== null) ctx.addIssue({ code: "custom", message: problem });
    });
}

function rosterIssues(posting: PostingState, ctx: z.RefinementCtx): void {
  ascendingIdIssues(
    posting.delegates,
    posting.nextDelegateId,
    "nextDelegateId",
    ["delegates"],
    ctx,
  );
  const names = new Set<string>();
  for (const [index, { name }] of posting.delegates.entries()) {
    if (names.has(name)) {
      ctx.addIssue({
        code: "custom",
        message: `"${name}" is held by another peasant`,
        path: ["delegates", index, "name"],
      });
    }
    names.add(name);
  }

  const living = new Set(posting.delegates.map(({ id }) => id));
  for (const [index, { parties }] of posting.desk.disputes.entries()) {
    const [first, second] = parties;
    if (first === second || !living.has(first) || !living.has(second)) {
      ctx.addIssue({
        code: "custom",
        message: "must be two distinct peasants in the roster",
        path: ["desk", "disputes", index, "parties"],
      });
    }
  }
}

function tickBoundIssues(state: GameState, ctx: z.RefinementCtx): void {
  if (state.career.promotedAt > state.tick) {
    ctx.addIssue({
      code: "custom",
      message: "must not exceed tick",
      path: ["career", "promotedAt"],
    });
  }
  for (const [index, { arrivedAt }] of state.posting.desk.disputes.entries()) {
    if (arrivedAt > state.tick) {
      ctx.addIssue({
        code: "custom",
        message: "must be no later than the tick",
        path: ["posting", "desk", "disputes", index, "arrivedAt"],
      });
    }
  }
}

const resources = z
  .record(z.string(), z.number())
  .superRefine((amounts, ctx) => {
    for (const id of RESOURCES) {
      if (!Object.hasOwn(amounts, id)) {
        ctx.addIssue({ code: "custom", message: "is missing", path: [id] });
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
    desk,
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
    for (const issue of result.error.issues) {
      problems.push(formatIssue(issue, "$"));
    }
  }
  return problems;
}

export function assertValidState(state: unknown): asserts state is GameState {
  const problems = validateState(state);
  if (problems.length > 0) {
    throw new Error(`invalid game state:\n${problems.join("\n")}`);
  }
}
