import { describe, expect, test } from "bun:test";
import { setRoster, tuning } from "../../test/helpers";
import type { Command } from "../core/commands";
import type { Condition } from "../core/decree";
import { createNewGame } from "../core/state";
import { createStrategyPlayer, parseStrategy, type Reaction } from "./strategy";

const noop: Command = { type: "noop" };
const sell: Command = {
  type: "enactDecree",
  decree: { id: "granary", petition: "harvest", rules: [], otherwise: "sell" },
};
const populationAbove: Condition = {
  kind: "compare",
  quantity: "population",
  comparison: "above",
  value: 5,
};
const grainAbove: Condition = {
  kind: "compare",
  quantity: "grain",
  comparison: "above",
  value: 100,
};

function parse(value: unknown) {
  return parseStrategy(value, tuning.decrees);
}

describe("parseStrategy", () => {
  test("rejects a chose condition nested inside all", () => {
    const parseNested = () =>
      parse({
        name: "s",
        setup: [],
        reactions: [
          {
            when: {
              kind: "all",
              conditions: [
                grainAbove,
                { kind: "chose", decree: "granary", policy: "sell" },
              ],
            },
            commands: [],
          },
        ],
      });

    expect(parseNested).toThrow(
      "strategy.reactions[0].when: chose conditions are not available to strategies",
    );
  });
});

function playerWith(...reactions: Reaction[]) {
  return createStrategyPlayer({ name: "s", setup: [sell], reactions });
}

describe("createStrategyPlayer", () => {
  function observeWith(
    player: ReturnType<typeof playerWith>,
    population: number,
  ) {
    const state = createNewGame(1, tuning);
    setRoster(state, { idle: population });
    player.observe(state, tuning);
  }

  test("next hands out copies of the setup first and nothing afterwards when no reaction fires", () => {
    const player = playerWith();

    const [handed] = player.next();
    const second = player.next();

    expect(handed).toEqual(sell);
    expect(handed).not.toBe(sell);
    expect(second).toEqual([]);
  });

  test("a reaction fires once when its condition turns true, and again only after it turned false", () => {
    const player = playerWith({ when: populationAbove, commands: [noop] });
    player.next();
    const fired = () => {
      const commands = player.next();
      return commands.length;
    };

    observeWith(player, 8);
    const onRise = fired();
    observeWith(player, 9);
    const whileTrue = fired();
    observeWith(player, 1);
    const whileFalse = fired();
    observeWith(player, 8);
    const again = fired();

    expect([onRise, whileTrue, whileFalse, again]).toEqual([1, 0, 0, 1]);
  });

  test("reactions that fire together hand out commands in file order", () => {
    const other: Command = { type: "repealDecree", id: "granary" };
    const player = playerWith(
      { when: populationAbove, commands: [noop] },
      { when: populationAbove, commands: [other] },
    );
    player.next();

    observeWith(player, 8);

    expect(player.next()).toEqual([noop, other]);
  });

  test("stats count acting ticks and the longest quiet run", () => {
    const player = playerWith({ when: populationAbove, commands: [noop] });
    const populationAfterStep = [1, 1, 8, 1, 1, 1, 8, 1, 1, 1];
    for (const population of populationAfterStep) {
      player.next();
      observeWith(player, population);
    }

    expect(player.stats()).toEqual({
      setupCommands: 1,
      reactionCommands: 2,
      actingTicks: 2,
      longestQuietTicks: 3,
    });
  });
});
