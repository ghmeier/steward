import { describe, expect, test } from "bun:test";
import { tuning } from "../../test/helpers";
import { copy } from "../core/copy";
import type { Condition, Decree } from "../core/decree";
import {
  describePolicy,
  formatCondition,
  formatDecree,
  formatPolicy,
} from "./decree-format";

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

describe("formatPolicy", () => {
  test("shows a labor split as dotted jobs and shares, and leaves a preset alone", () => {
    expect(formatPolicy("farm 60 forest 30 mine 10")).toBe(
      "farm 60 · forest 30 · mine 10",
    );
    expect(formatPolicy("balanced")).toBe("balanced");
  });
});

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

  test("a compound condition wraps its formatted parts in the matching copy", () => {
    const parts = `${formatCondition(spring)}, ${formatCondition(poor)}`;

    const all = formatDecree(
      decreeWith({ kind: "all", conditions: [spring, poor] }),
    );
    const any = formatDecree(
      decreeWith({ kind: "any", conditions: [spring, poor] }),
    );

    expect(all).toContain(copy.decrees.allOf({ conditions: parts }));
    expect(any).toContain(copy.decrees.anyOf({ conditions: parts }));
  });

  test("a compare condition shows its quantity, comparison and value, a full condition its resource, and a not condition wraps its inner one", () => {
    const compare: Condition = {
      kind: "compare",
      quantity: "grainSeasons",
      comparison: "above",
      value: 3,
    };

    expect(formatCondition(compare)).toBe("grain seasons above 3");
    expect(formatCondition({ kind: "full", resource: "wood" })).toBe(
      "wood is full",
    );
    expect(formatCondition({ kind: "not", condition: compare })).toContain(
      formatCondition(compare),
    );
  });
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

  test("a policy that gives everyone one job names the matching copy", () => {
    expect(describePolicy("labor", "lumberjacks", inline)).toBe(
      `lumberjacks: ${copy.decrees.everyone.forest}`,
    );
  });

  test("a split policy lists each job with its share", () => {
    expect(describePolicy("labor", "halves", inline)).toBe(
      "halves: farm 25%, forest 25%, mine 50%",
    );
  });

  test("a store policy and a harvest policy take their description from copy", () => {
    expect(describePolicy("ore", "sell", inline)).toBe(
      `sell: ${copy.decrees.storePolicies.sell({ resource: "ore" })}`,
    );
    expect(describePolicy("harvest", "feed", inline)).toBe(
      `feed: ${copy.decrees.harvestPolicies.feed}`,
    );
  });

  test("a policy nobody described is shown as its bare name", () => {
    expect(describePolicy("harvest", "mystery", inline)).toBe("mystery");
  });
});
