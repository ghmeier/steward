import { z } from "zod";
import { type Command, commandSchema } from "../core/commands";
import {
  type Condition,
  conditionSchema,
  type DecreeLimits,
} from "../core/decree";
import { addIssue, parseWith } from "../core/errors";
import type { Game } from "../core/game";
import {
  ARCHIVE_PANEL,
  CONJURING,
  COURT_PANEL,
  CROWN_PANEL,
  costLines,
  DECREES_PANEL,
  FORGING,
  type UnlockId,
} from "../core/unlocks";

export type Reaction = { when: Condition; commands: Command[] };
/** A setup command may also wait for a condition, which it needs only once to be released. */
export type SetupStep = Command | { when: Condition; command: Command };
export type Strategy = {
  name: string;
  setup: SetupStep[];
  /** Archive entries bought in this order, each as soon as it is on offer and affordable. */
  purchases: string[];
  reactions: Reaction[];
};
export type StrategyStats = {
  setupCommands: number;
  purchaseCommands: number;
  reactionCommands: number;
  actingTicks: number;
  longestQuietTicks: number;
};

/** The unlock a command needs before the game would let a player issue it, or undefined when it needs none. */
export function unlockNeededBy(command: Command): UnlockId | undefined {
  switch (command.type) {
    case "enactDecree":
    case "repealDecree":
    case "saveDecree":
    case "enactSaved":
    case "forgetSaved":
      return DECREES_PANEL;
    case "settleDispute":
    case "settle":
      return COURT_PANEL;
    case "deliver":
      return CROWN_PANEL;
    case "forge":
      return FORGING;
    case "conjure":
      return CONJURING;
    case "buyUnlock":
      return ARCHIVE_PANEL;
    default:
      return undefined;
  }
}

function stepCommand(step: SetupStep): Command {
  return "command" in step ? step.command : step;
}

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
  const setupStep = z.union([
    commandSchema,
    z.strictObject({ when: conditionSchema(limits), command: commandSchema }),
  ]);
  return z.strictObject({
    name: z.string().min(1),
    setup: z.array(setupStep),
    purchases: z.array(z.string()),
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
  let waiting: SetupStep[] = [...strategy.setup];
  // A step whose condition has held stays released even if the condition later stops holding.
  const released = new Set<SetupStep>();
  let owned: ReadonlySet<UnlockId> = new Set();
  let pending: Command[] = [];
  let purchase: Command[] = [];
  let setupCommands = 0;
  let purchaseCommands = 0;
  let reactionCommands = 0;
  let actingTicks = 0;
  let quiet = 0;
  let longestQuietTicks = 0;

  const copy = (command: Command): Command => structuredClone(command);
  const canIssue = (command: Command): boolean => {
    const needed = unlockNeededBy(command);
    return needed === undefined || owned.has(needed);
  };

  return {
    next() {
      const setup = waiting.filter(
        (step) =>
          ("command" in step ? released.has(step) : true) &&
          canIssue(stepCommand(step)),
      );
      waiting = waiting.filter((step) => !setup.includes(step));
      setupCommands += setup.length;
      const reactions = pending;
      reactionCommands += reactions.length;
      purchaseCommands += purchase.length;
      if (reactions.length > 0) {
        actingTicks += 1;
        quiet = 0;
      } else {
        quiet += 1;
      }
      longestQuietTicks = Math.max(longestQuietTicks, quiet);
      const handed = [
        ...setup.map((step) => copy(stepCommand(step))),
        ...purchase,
        ...reactions,
      ];
      pending = [];
      purchase = [];
      return handed;
    },
    observe(game) {
      owned = new Set(game.unlocks.purchased);
      for (const step of waiting) {
        if ("command" in step && game.conditions.evaluate(step.when, {})) {
          released.add(step);
        }
      }
      const fired: Command[] = [];
      for (const [index, reaction] of strategy.reactions.entries()) {
        const holds = game.conditions.evaluate(reaction.when, {});
        if (holds && !held[index]) {
          fired.push(...reaction.commands.map(copy).filter(canIssue));
        }
        held[index] = holds;
      }
      pending = fired;
      purchase = nextPurchase(game);
    },
    stats: () => ({
      setupCommands,
      purchaseCommands,
      reactionCommands,
      actingTicks,
      longestQuietTicks,
    }),
  };

  function nextPurchase(game: Game): Command[] {
    const id = strategy.purchases.find((candidate) => !owned.has(candidate));
    if (id === undefined || !owned.has(ARCHIVE_PANEL)) return [];
    const entry = game.unlocks.offered().find((offered) => offered.id === id);
    if (entry === undefined) return [];
    const affordable = costLines(entry).every(
      ({ resource, amount }) => game.illusion.apparent(resource) >= amount,
    );
    return affordable ? [{ type: "buyUnlock", id }] : [];
  }
}
