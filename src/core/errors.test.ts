import { expect, test } from "bun:test";
import { z } from "zod";
import { formatIssues, parseWith } from "./errors";

const schema = z.strictObject({
  name: z.string(),
  items: z.array(z.strictObject({ count: z.int() })),
});

test("formatIssues renders keys as .key and array indexes as [n] under the root, joined by semicolons", () => {
  const result = schema.safeParse({
    name: 1,
    items: [{ count: 1 }, { count: "x" }],
  });

  const text = result.success ? "" : formatIssues(result.error, "root");

  expect(text).toStartWith("root.name: ");
  expect(text).toContain("; root.items[1].count: ");
});

test("formatIssues puts a problem at the root directly after the root name", () => {
  const result = schema.safeParse(4);

  expect(result.success ? "" : formatIssues(result.error, "root")).toStartWith(
    "root: ",
  );
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
