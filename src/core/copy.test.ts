import { describe, expect, test } from "bun:test";
import { copy, plural } from "./copy";

const SAMPLE_ARGUMENTS: Record<string, unknown> = {
  names: ["Ada", "Hob", "Cole"],
  deaths: 3,
  entryId: 7,
};

function argumentsFor(): Record<string, unknown> {
  return new Proxy(SAMPLE_ARGUMENTS, {
    get: (known, name) => known[String(name)] ?? `sample-${String(name)}`,
  });
}

function* templates(
  node: object,
  path: string,
): Generator<[string, (args: Record<string, unknown>) => string]> {
  for (const [name, value] of Object.entries(node)) {
    const here = `${path}.${name}`;
    if (typeof value === "function") yield [here, value];
    else if (typeof value === "object") yield* templates(value, here);
  }
}

function* statics(node: object, path: string): Generator<[string, string]> {
  for (const [name, value] of Object.entries(node)) {
    const here = `${path}.${name}`;
    if (typeof value === "string") yield [here, value];
    else if (typeof value === "object") yield* statics(value, here);
  }
}

const UNFILLED = /\$\{|\{\w+\}/;

describe("copy", () => {
  test("every template returns a non-empty sentence with no unfilled placeholder", () => {
    const all = [...templates(copy, "copy")];

    expect(all.length).toBeGreaterThan(0);
    for (const [path, template] of all) {
      const text = template(argumentsFor());

      expect(text, path).not.toBe("");
      expect(text, path).not.toMatch(UNFILLED);
    }
  });

  test("every static line is non-empty and has no placeholder", () => {
    for (const [path, text] of statics(copy, "copy")) {
      expect(text, path).not.toBe("");
      expect(text, path).not.toMatch(UNFILLED);
    }
  });
});

describe("plural", () => {
  test("picks the singular form for exactly one and the plural form otherwise", () => {
    expect(plural(1, "other", "others")).toBe("other");
    expect(plural(0, "other", "others")).toBe("others");
    expect(plural(3, "other", "others")).toBe("others");
  });
});
