import { z } from "zod";
import { compareKeys, isRecord, sortedKeys } from "./data";
import { addIssue, type IssuePath, parseWith } from "./errors";
import { normalizeZero } from "./math";
import { SEASONS, type Season } from "./realm";
import type { Tuning } from "./tuning";

export const PETITIONS = ["harvest", "wood", "ore", "labor"] as const;
export type Petition = (typeof PETITIONS)[number];
export const QUANTITIES = [
  "coin",
  "grain",
  "grainSeasons",
  "idle",
  "ore",
  "owedCoin",
  "owedGrain",
  "owedOre",
  "owedWood",
  "population",
  "wood",
] as const;
export type Quantity = (typeof QUANTITIES)[number];
export type Condition =
  | {
      kind: "compare";
      quantity: Quantity;
      comparison: "above" | "below";
      value: number;
    }
  | { kind: "season"; season: Season }
  | { kind: "chose"; decree: string; policy: string }
  | { kind: "all"; conditions: Condition[] }
  | { kind: "any"; conditions: Condition[] }
  | { kind: "not"; condition: Condition };
export type DecreeRule = { when: Condition; policy: string };
export type Decree = {
  id: string;
  petition: Petition;
  rules: DecreeRule[];
  otherwise: string;
};
export type DecreeLimits = {
  maxRules: number;
  maxConditionNodes: number;
  maxConditionDepth: number;
};

export const DECREE_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

const decreeId = z.string().regex(DECREE_ID_PATTERN);
const policyName = z.string().min(1);

// Zod's lazy schemas recurse without a cap, so untrusted input is bounded before it reaches them.
const MAX_CONDITION_NESTING = 64;

function conditionGroup<K extends "all" | "any">(kind: K) {
  return z.strictObject({
    kind: z.literal(kind),
    conditions: z.array(conditionTree).min(1),
  });
}

const conditionTree: z.ZodType<Condition> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("compare"),
      quantity: z.enum(QUANTITIES),
      comparison: z.enum(["above", "below"]),
      value: z.number().transform(normalizeZero),
    }),
    z.strictObject({ kind: z.literal("season"), season: z.enum(SEASONS) }),
    z.strictObject({
      kind: z.literal("chose"),
      decree: decreeId,
      policy: policyName,
    }),
    conditionGroup("all"),
    conditionGroup("any"),
    z.strictObject({ kind: z.literal("not"), condition: conditionTree }),
  ]),
);

/** The path to the first node nested past `maxLevels` levels, found without recursing past the cap. */
function firstTooDeepPath(
  value: unknown,
  maxLevels: number,
  path: IssuePath = [],
  level = 1,
): IssuePath | null {
  if (!isRecord(value)) return null;
  if (level > maxLevels) return path;
  if (value.kind === "not") {
    return firstTooDeepPath(
      value.condition,
      maxLevels,
      [...path, "condition"],
      level + 1,
    );
  }
  if (
    (value.kind === "all" || value.kind === "any") &&
    Array.isArray(value.conditions)
  ) {
    for (const [index, child] of value.conditions.entries()) {
      const found = firstTooDeepPath(
        child,
        maxLevels,
        [...path, "conditions", index],
        level + 1,
      );
      if (found !== null) return found;
    }
  }
  return null;
}

/** Nodes are counted in reading order, so the first node past a limit is the one reported. */
export function conditionSchema(limits: DecreeLimits): z.ZodType<Condition> {
  return z
    .unknown()
    .superRefine((value, ctx) => {
      const path = firstTooDeepPath(value, MAX_CONDITION_NESTING);
      if (path !== null) {
        addIssue(
          ctx,
          `nests deeper than ${MAX_CONDITION_NESTING} levels`,
          path,
        );
      }
    })
    .pipe(conditionTree)
    .superRefine((condition, ctx) => {
      let nodes = 0;
      const withinLimits = (
        node: Condition,
        at: IssuePath,
        depth: number,
      ): boolean => {
        if (depth > limits.maxConditionDepth) {
          addIssue(
            ctx,
            `nests deeper than ${limits.maxConditionDepth} levels`,
            at,
          );
          return false;
        }
        nodes += 1;
        if (nodes > limits.maxConditionNodes) {
          addIssue(
            ctx,
            `condition has more than ${limits.maxConditionNodes} nodes`,
            at,
          );
          return false;
        }
        switch (node.kind) {
          case "all":
          case "any":
            return node.conditions.every((child, index) =>
              withinLimits(child, [...at, "conditions", index], depth + 1),
            );
          case "not":
            return withinLimits(
              node.condition,
              [...at, "condition"],
              depth + 1,
            );
          default:
            return true;
        }
      };
      withinLimits(condition, [], 1);
    });
}

export function decreeSchema(limits: DecreeLimits): z.ZodType<Decree> {
  const rule = z.strictObject({
    when: conditionSchema(limits),
    policy: policyName,
  });
  return z.strictObject({
    id: decreeId,
    petition: z.enum(PETITIONS),
    rules: z.array(rule).superRefine((rules, ctx) => {
      if (rules.length > limits.maxRules) {
        addIssue(ctx, `has more than ${limits.maxRules} rules`);
      }
    }),
    otherwise: policyName,
  });
}

export function parseCondition(
  value: unknown,
  limits: DecreeLimits,
  root: string,
): Condition {
  return parseWith(conditionSchema(limits), value, root);
}

export function parseDecree(value: unknown, limits: DecreeLimits): Decree {
  return parseWith(decreeSchema(limits), value, "decree");
}

function collectChoses(
  condition: Condition,
  into: { decree: string; policy: string }[],
): void {
  switch (condition.kind) {
    case "chose":
      into.push({ decree: condition.decree, policy: condition.policy });
      return;
    case "all":
    case "any":
      for (const child of condition.conditions) collectChoses(child, into);
      return;
    case "not":
      collectChoses(condition.condition, into);
      return;
    default:
      return;
  }
}

export function choseConditions(
  decree: Decree,
): { decree: string; policy: string }[] {
  const found: { decree: string; policy: string }[] = [];
  for (const rule of decree.rules) collectChoses(rule.when, found);
  return found;
}

export function decreeReferences(decree: Decree): string[] {
  const found = new Set(choseConditions(decree).map((entry) => entry.decree));
  return [...found].sort(compareKeys);
}

export type DecreeOrder =
  | { ok: true; order: string[] }
  | { ok: false; cycle: string[] };

export function orderDecrees(
  decrees: Readonly<Record<string, Decree>>,
): DecreeOrder {
  const ids = sortedKeys(decrees);
  const dependencies = new Map<string, string[]>();
  for (const id of ids) {
    const decree = decrees[id];
    const known = decree
      ? decreeReferences(decree).filter((ref) => Object.hasOwn(decrees, ref))
      : [];
    dependencies.set(id, known);
  }

  const placed = new Set<string>();
  const order: string[] = [];
  for (;;) {
    const next = ids.find(
      (id) =>
        !placed.has(id) &&
        (dependencies.get(id) ?? []).every((ref) => placed.has(ref)),
    );
    if (next === undefined) break;
    placed.add(next);
    order.push(next);
  }
  if (order.length === ids.length) return { ok: true, order };

  // Every unplaced decree waits on another unplaced one, so following those edges must revisit an id.
  const walk: string[] = [];
  let current = ids.find((id) => !placed.has(id));
  while (current !== undefined && !walk.includes(current)) {
    walk.push(current);
    current = (dependencies.get(current) ?? []).find((ref) => !placed.has(ref));
  }
  return {
    ok: false,
    cycle: current === undefined ? walk : walk.slice(walk.indexOf(current)),
  };
}

export const HARVEST_POLICIES = ["feed", "sell", "stockpile"] as const;
export const STORE_POLICIES = ["sell", "stockpile"] as const;

/** The policies a decree of this petition may name; the TUI lists them from tuning alone, without a game. */
export function policiesFor(
  petition: Petition,
  tuning: Tuning,
): readonly string[] {
  if (petition === "harvest") return HARVEST_POLICIES;
  if (petition === "labor") return sortedKeys(tuning.economy.laborAllocations);
  return STORE_POLICIES;
}

/** The resource each resource petition governs; `harvest` keeps its id for grain so saves stay valid. */
export const PETITION_RESOURCE = {
  harvest: "grain",
  wood: "wood",
  ore: "ore",
} as const;
export type ResourcePetition = keyof typeof PETITION_RESOURCE;

export function formatCycle(cycle: readonly string[]): string {
  return [...cycle, cycle[0]].join(" -> ");
}

/** The first rule or otherwise policy the decree's petition does not offer, or null. */
export function decreePolicyProblem(
  decree: Decree,
  allowed: readonly string[],
): string | null {
  const used = [...decree.rules.map((rule) => rule.policy), decree.otherwise];
  for (const policy of used) {
    if (!allowed.includes(policy)) {
      return `policy "${policy}" is not a ${decree.petition} policy`;
    }
  }
  return null;
}

/**
 * The checks on a whole decree set that need no tuning, shared by enacting and by
 * state validation. Labor policies are only checked when the caller can supply them.
 * `incoming` is the decree being enacted, so a petition clash names the decree already in place.
 */
export function decreeSetProblem(
  decrees: Readonly<Record<string, Decree>>,
  laborPolicies: readonly string[] | null,
  incoming?: string,
): string | null {
  const ids = sortedKeys(decrees);
  const policiesOf = (petition: Petition): readonly string[] | null => {
    if (petition === "harvest") return HARVEST_POLICIES;
    if (petition === "labor") return laborPolicies;
    return STORE_POLICIES;
  };

  for (const id of ids) {
    const decree = decrees[id];
    if (!decree) continue;
    const allowed = policiesOf(decree.petition);
    if (!allowed) continue;
    const problem = decreePolicyProblem(decree, allowed);
    if (problem !== null) return `decree "${id}": ${problem}`;
  }

  const handlers = new Map<Petition, string[]>();
  for (const id of ids) {
    const petition = decrees[id]?.petition;
    if (petition)
      handlers.set(petition, [...(handlers.get(petition) ?? []), id]);
  }
  for (const petition of PETITIONS) {
    const handling = handlers.get(petition) ?? [];
    if (handling.length > 1) {
      const other = handling.find((id) => id !== incoming) ?? handling[0];
      return `decree "${other}" already handles the ${petition} petition`;
    }
  }

  for (const id of ids) {
    const decree = decrees[id];
    if (!decree) continue;
    for (const test of choseConditions(decree)) {
      const target = Object.hasOwn(decrees, test.decree)
        ? decrees[test.decree]
        : undefined;
      if (!target) {
        return `decree "${id}" references unknown decree "${test.decree}"`;
      }
      const allowed = policiesOf(target.petition);
      if (allowed && !allowed.includes(test.policy)) {
        return `decree "${id}" tests for policy "${test.policy}", which decree "${test.decree}" cannot choose`;
      }
    }
  }

  const order = orderDecrees(decrees);
  if (!order.ok) return `decree cycle: ${formatCycle(order.cycle)}`;
  return null;
}
