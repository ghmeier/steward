import { expect, test } from "bun:test";
import { z } from "zod";
import { formatIssues, parseWith } from "./errors";

const schema = z.strictObject({
  name: z.string(),
  items: z.array(z.strictObject({ count: z.int() })),
});

test("formatIssues renders keys as .key, indexes as [n], joins with semicolons, and names the root alone for a root problem", () => {
  const nested = schema.safeParse({
    name: 1,
    items: [{ count: 1 }, { count: "x" }],
  });
  const atRoot = schema.safeParse(4);

  const nestedText = nested.success ? "" : formatIssues(nested.error, "root");
  const rootText = atRoot.success ? "" : formatIssues(atRoot.error, "root");

  expect(nestedText).toStartWith("root.name: ");
  expect(nestedText).toContain("; root.items[1].count: ");
  expect(rootText).toStartWith("root: ");
});

test("parseWith returns parsed data and throws an Error carrying the formatted text", () => {
  expect(parseWith(schema, { name: "a", items: [] }, "root")).toEqual({
    name: "a",
    items: [],
  });
  expect(() => parseWith(schema, { name: "a" }, "root")).toThrow(
    "root.items: ",
  );
});
