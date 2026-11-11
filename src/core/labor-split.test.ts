import { describe, expect, test } from "bun:test";
import { tuning } from "../../test/helpers";
import { copy } from "./copy";
import { Game } from "./game";
import { LaborSplit } from "./labor-split";

function enactLabor(game: Game, policy: string) {
  game.decrees.enact({
    id: "workforce",
    petition: "labor",
    rules: [],
    otherwise: policy,
  });
}

describe("LaborSplit.parse", () => {
  test("reads weights in any order, writes them in a fixed order, and divides by the total for shares", () => {
    const result = LaborSplit.parse("mine 1 forest 0 farm 2");

    expect(result).toMatchObject({
      ok: true,
      split: { weights: { farm: 2, forest: 0, mine: 1 } },
    });
    expect(result.ok && result.split.format()).toBe("farm 2 mine 1");
    expect(result.ok && result.split.format(" · ")).toBe("farm 2 · mine 1");
    expect(result.ok && result.split.shares()).toEqual({
      farm: 2 / 3,
      forest: 0,
      mine: 1 / 3,
    });
  });

  test("a policy without a space is a preset name, not a split", () => {
    expect(LaborSplit.fromPolicy("balanced")).toBeNull();
    expect(LaborSplit.fromPolicy("farm 1")).toMatchObject({ ok: true });
  });

  test.each([
    ["farm 0 forest 0", copy.laborSplit.allZero],
    ["farm 1 farm 2", copy.laborSplit.duplicateJob({ job: "farm" })],
    ["wood 1 farm 2", copy.laborSplit.unknownJob({ job: "wood" })],
    ["farm 1 mine", copy.laborSplit.unpaired],
    ["farm -1 mine 2", copy.laborSplit.badWeight({ job: "farm", text: "-1" })],
    ["farm lots", copy.laborSplit.badWeight({ job: "farm", text: "lots" })],
  ])("rejects %j with a clear reason", (policy, problem) => {
    expect(LaborSplit.parse(policy)).toEqual({ ok: false, problem });
  });
});

describe("enacting a labor decree with a split", () => {
  test("accepts a valid split in a rule and in otherwise, next to a preset", () => {
    const game = Game.create(1, tuning);

    game.decrees.enact({
      id: "workforce",
      petition: "labor",
      rules: [
        {
          when: { kind: "season", season: "winter" },
          policy: "farm 60 forest 30 mine 10",
        },
      ],
      otherwise: "balanced",
    });

    expect(game.decrees.enacted.workforce?.rules[0]?.policy).toBe(
      "farm 60 forest 30 mine 10",
    );
  });

  test("rejects an all-zero split, a duplicate job and an unknown job", () => {
    const game = Game.create(1, tuning);

    expect(() => enactLabor(game, "farm 0 mine 0")).toThrow(
      copy.laborSplit.allZero,
    );
    expect(() => enactLabor(game, "farm 1 farm 2")).toThrow(
      copy.laborSplit.duplicateJob({ job: "farm" }),
    );
    expect(() => enactLabor(game, "wood 1")).toThrow(
      copy.laborSplit.unknownJob({ job: "wood" }),
    );
    expect(game.decrees.enacted.workforce).toBeUndefined();
  });

  test("a word that is neither a preset nor a split is still not a labor policy", () => {
    const game = Game.create(1, tuning);

    expect(() => enactLabor(game, "idle")).toThrow(
      'policy "idle" is not a labor policy',
    );
  });
});
