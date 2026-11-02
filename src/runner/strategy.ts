import { z } from "zod";
import { type Command, commandSchema } from "../core/commands";
import {
  type Condition,
  conditionSchema,
  type DecreeLimits,
} from "../core/decree";
import { addIssue, parseWith } from "../core/errors";
import type { Game } from "../core/game";

export type Reaction = { when: Condition; commands: Command[] };
export type Strategy = {
  name: string;
  setup: Command[];
  reactions: Reaction[];
};
export type StrategyStats = {
  setupCommands: number;
  reactionCommands: number;
  actingTicks: number;
  longestQuietTicks: number;
};

function containsChose(condition: Condition): boolean {
  switch (condition.kind) {
    case "chose":
      return true;
    case "all":
    case "any":
      return condition.conditions.some(containsChose);
    case "not":
      return containsChose(condition.condition);
    default:
      return false;
  }
}

function strategySchema(limits: DecreeLimits): z.ZodType<Strategy> {
  const commands = z.array(commandSchema);
  const reaction = z
    .strictObject({ when: conditionSchema(limits), commands })
    .superRefine((entry, ctx) => {
      if (containsChose(entry.when)) {
        addIssue(ctx, "chose conditions are not available to strategies", [
          "when",
        ]);
      }
    });
  return z.strictObject({
    name: z.string().min(1),
    setup: commands,
    reactions: z.array(reaction),
  });
}

export function parseStrategy(value: unknown, limits: DecreeLimits): Strategy {
  return parseWith(strategySchema(limits), value, "strategy");
}

export type StrategyPlayer = {
  next(): Command[];
  observe(game: Game): void;
  stats(): StrategyStats;
};

export function createStrategyPlayer(strategy: Strategy): StrategyPlayer {
  const held = strategy.reactions.map(() => false);
  let pending: Command[] = [];
  let started = false;
  let setupCommands = 0;
  let reactionCommands = 0;
  let actingTicks = 0;
  let quiet = 0;
  let longestQuietTicks = 0;

  const copy = (commands: readonly Command[]): Command[] =>
    commands.map((command) => structuredClone(command));

  return {
    next() {
      let handed: Command[];
      if (!started) {
        started = true;
        handed = copy(strategy.setup);
        setupCommands += handed.length;
        pending = [];
        quiet += 1;
      } else {
        handed = pending;
        pending = [];
        reactionCommands += handed.length;
        if (handed.length > 0) {
          actingTicks += 1;
          quiet = 0;
        } else {
          quiet += 1;
        }
      }
      longestQuietTicks = Math.max(longestQuietTicks, quiet);
      return handed;
    },
    observe(game) {
      const fired: Command[] = [];
      for (const [index, reaction] of strategy.reactions.entries()) {
        const holds = game.conditions.evaluate(reaction.when, {});
        if (holds && !held[index]) fired.push(...copy(reaction.commands));
        held[index] = holds;
      }
      pending = fired;
    },
    stats: () => ({
      setupCommands,
      reactionCommands,
      actingTicks,
      longestQuietTicks,
    }),
  };
}
