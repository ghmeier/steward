import { describe, expect, test } from "bun:test";
import { copy, plural } from "./copy";

// Arguments that are not plain strings. Any other argument name is sampled as a string.
const NON_STRING_ARGUMENTS: Record<string, unknown> = {
  names: ["Ada", "Hob", "Cole"],
  deaths: 3,
  entryId: 7,
};

const SAMPLE_ARGUMENTS = new Proxy(NON_STRING_ARGUMENTS, {
  get: (known, name) => known[String(name)] ?? `sample-${String(name)}`,
});

type Template = string | ((args: Record<string, unknown>) => string);

function* templates(node: object, path: string): Generator<[string, Template]> {
  for (const [name, value] of Object.entries(node)) {
    const here = `${path}.${name}`;
    if (typeof value === "object") yield* templates(value, here);
    else yield [here, value];
  }
}

const UNFILLED = /\$\{|\{\w+\}/;

describe("copy", () => {
  test("every line renders a non-empty string with no unfilled placeholder", () => {
    const all = [...templates(copy, "copy")];

    expect(all.length).toBeGreaterThan(0);
    for (const [path, template] of all) {
      const text =
        typeof template === "string" ? template : template(SAMPLE_ARGUMENTS);

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
