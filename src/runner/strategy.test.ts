import { describe, expect, test } from "bun:test";
import { grantUnlocks, setRoster, tuning } from "../../test/helpers";
import type { Command } from "../core/commands";
import type { Condition } from "../core/decree";
import { Game } from "../core/game";
import { Job } from "../core/realm";
import { ARCHIVE_PANEL, CROWN_PANEL, DECREES_PANEL } from "../core/unlocks";
import {
  createStrategyPlayer,
  parseStrategy,
  type Reaction,
  type SetupStep,
} from "./strategy";

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
        purchases: [],
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
  return createStrategyPlayer({
    name: "s",
    setup: [noop],
    purchases: [],
    reactions,
  });
}

describe("createStrategyPlayer", () => {
  function observeWith(
    player: ReturnType<typeof playerWith>,
    population: number,
  ) {
    const game = Game.create(1, tuning);
    setRoster(game, { idle: population });
    player.observe(game);
  }

  test("next hands out copies of the setup first and nothing afterwards when no reaction fires", () => {
    const player = playerWith();

    const [handed] = player.next();
    const second = player.next();

    expect(handed).toEqual(noop);
    expect(handed).not.toBe(noop);
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
    const other: Command = { type: "assignPeasant", peasant: 1, job: Job.FARM };
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
      purchaseCommands: 0,
      reactionCommands: 2,
      actingTicks: 2,
      longestQuietTicks: 3,
    });
  });
});

describe("createStrategyPlayer with locked panels", () => {
  function playerFor(setup: SetupStep[], purchases: string[] = []) {
    return createStrategyPlayer({ name: "s", setup, purchases, reactions: [] });
  }

  test("a setup command that needs the Decrees panel waits until the panel is owned", () => {
    const player = playerFor([sell]);
    const game = Game.create(1, tuning);

    player.observe(game);
    const whileLocked = player.next();
    grantUnlocks(game, [DECREES_PANEL]);
    player.observe(game);
    const onceOwned = player.next();

    expect(whileLocked).toEqual([]);
    expect(onceOwned).toEqual([sell]);
  });

  test("a setup command with a condition is released once the condition has held, even if it stops holding", () => {
    const player = playerFor([{ when: grainAbove, command: noop }]);
    const game = Game.create(1, tuning);

    player.observe(game);
    const before = player.next();
    game.state.posting.resources.grain = 500;
    player.observe(game);
    game.state.posting.resources.grain = 0;
    const after = player.next();

    expect(before).toEqual([]);
    expect(after).toEqual([noop]);
  });

  test("a purchase is issued once it is on offer and affordable, and the next one waits for it", () => {
    const player = playerFor([], [DECREES_PANEL, CROWN_PANEL]);
    const game = Game.create(1, tuning);
    grantUnlocks(game, [ARCHIVE_PANEL]);
    game.state.career.seen[DECREES_PANEL] = 0;
    game.state.career.seen[CROWN_PANEL] = 0;

    player.observe(game);
    const unaffordable = player.next();
    game.state.posting.resources.wood = 40;
    player.observe(game);
    const affordable = player.next();

    expect(unaffordable).toEqual([]);
    expect(affordable).toEqual([{ type: "buyUnlock", id: DECREES_PANEL }]);
  });
});
