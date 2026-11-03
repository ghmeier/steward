import { describe, expect, test } from "bun:test";
import { wrapLine } from "./wrap";

describe("wrapLine", () => {
  test("breaks at spaces within the width, indents continuations by the line's indent plus the hanging indent, and keeps long words whole", () => {
    expect(wrapLine("short line", 20)).toEqual(["short line"]);
    expect(wrapLine("  one two three four", 10, 2)).toEqual([
      "  one two",
      "    three",
      "    four",
    ]);
    expect(wrapLine("a extraordinarily b", 8)).toEqual([
      "a",
      "extraordinarily",
      "b",
    ]);
  });
});
