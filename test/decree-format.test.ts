import { describe, expect, test } from "bun:test";
import type { Condition, Decree } from "../src/core/decree";
import { describePolicy, formatDecree } from "../src/tui/decree-format";
import { tuning } from "./helpers";

function decreeWith(when: Condition): Decree {
  return {
    id: "granary",
    petition: "harvest",
    rules: [{ when, policy: "sell" }],
    otherwise: "stockpile",
  };
}

const spring: Condition = { kind: "season", season: "spring" };
const poor: Condition = {
  kind: "compare",
  quantity: "coin",
  comparison: "below",
  value: 5,
};

describe("formatDecree", () => {
  test("lists the rules in order, then the otherwise policy", () => {
    const decree: Decree = {
      id: "granary",
      petition: "harvest",
      rules: [
        { when: poor, policy: "sell" },
        { when: spring, policy: "feed" },
      ],
      otherwise: "stockpile",
    };

    const text = formatDecree(decree);

    expect(text).toStartWith("granary (harvest):");
    expect(text.indexOf("sell when coin below 5")).toBeLessThan(
      text.indexOf("feed when it is spring"),
    );
    expect(text).toEndWith("otherwise stockpile");
  });

  test("a decree with no rules shows only the otherwise policy", () => {
    const bare: Decree = {
      id: "labor",
      petition: "labor",
      rules: [],
      otherwise: "balanced",
    };

    expect(formatDecree(bare)).toBe("labor (labor): otherwise balanced");
  });

  // biome-ignore format: one row per line keeps the table scannable
  const conditions: [string, Condition, string][] = [
		["compare", { kind: "compare", quantity: "grainSeasons", comparison: "above", value: 3 }, "grain seasons above 3"],
		["chose", { kind: "chose", decree: "workers", policy: "balanced" }, "workers chose balanced"],
		["all", { kind: "all", conditions: [spring, poor] }, "all of (it is spring, coin below 5)"],
		["any", { kind: "any", conditions: [spring, poor] }, "any of (it is spring, coin below 5)"],
		["not", { kind: "not", condition: spring }, "not (it is spring)"],
	];

  test.each(conditions)(
    "a %s rule shows its subject and values",
    (_name, when, fragment) => {
      expect(formatDecree(decreeWith(when))).toContain(fragment);
    },
  );
});

describe("describePolicy", () => {
  const inline = {
    ...tuning,
    economy: {
      ...tuning.economy,
      laborAllocations: {
        lumberjacks: { farm: 0, forest: 1, mine: 0 },
        halves: { farm: 0.25, forest: 0.25, mine: 0.5 },
      },
    },
  };

  // biome-ignore format: one row per line keeps the table scannable
  const rows: [string, string, string, string][] = [
		["labor", "lumberjacks", "forest", "everyone works the forest"],
		["labor", "halves", "mine", "mine 50%"],
		["ore", "sell", "ore", "sold for coin"],
		["harvest", "feed", "surplus", "grows the village"],
	];

  test.each(rows)(
    "%s policy %s names its %s",
    (petition, policy, noun, effect) => {
      const text = describePolicy(petition as "labor", policy, inline);

      expect(text).toStartWith(`${policy}:`);
      expect(text).toContain(noun);
      expect(text).toContain(effect);
    },
  );
});
