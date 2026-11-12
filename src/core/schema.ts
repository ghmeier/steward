import { z } from "zod";
import { addIssue, type IssuePath } from "./errors";
import { normalizeZero } from "./math";
import { TRAITS } from "./realm";

export const count = z.int().min(0);
export const positiveCount = z.int().min(1);
export const uint32 = z.int().min(0).max(0xffffffff);

export const traitList = z.array(z.enum(TRAITS));

export const nonNegative = z.number().min(0).transform(normalizeZero);
export const positive = z.number().gt(0).transform(normalizeZero);
export const positiveInteger = z.int().min(1);
export const name = z.string().min(1);

export function textWithPlaceholders(allowed: readonly string[]) {
  return name.superRefine((text, ctx) => {
    for (const match of text.matchAll(/\{([^{}]*)\}/g)) {
      if (!allowed.includes(match[1] ?? "")) {
        addIssue(ctx, `has unknown placeholder ${match[0]}`);
      }
    }
  });
}

export function repeatIssues(
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

export function ascendingIdIssues<List extends string, Next extends string>(
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
