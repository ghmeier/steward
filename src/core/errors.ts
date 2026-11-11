import type { z } from "zod";

export class InvalidStateError extends Error {}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Renders one problem as `<root><path>: <message>`, with keys as `.key` and array indexes as `[n]`. */
export function formatIssue(issue: z.core.$ZodIssue, root: string): string {
  const path = issue.path
    .map((part) =>
      typeof part === "number" ? `[${part}]` : `.${String(part)}`,
    )
    .join("");
  return `${root}${path}: ${issue.message}`;
}

export type IssuePath = (string | number)[];

export function addIssue(
  ctx: z.RefinementCtx,
  message: string,
  path: IssuePath = [],
): void {
  ctx.addIssue({ code: "custom", message, path });
}

export function formatIssues(error: z.ZodError, root: string): string {
  return error.issues.map((issue) => formatIssue(issue, root)).join("; ");
}

export function parseWith<T>(
  schema: z.ZodType<T>,
  value: unknown,
  root: string,
): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(formatIssues(result.error, root));
  return result.data;
}
