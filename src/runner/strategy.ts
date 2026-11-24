import { z } from "zod";
import { type Command, commandSchema } from "../core/commands";
import {
  type Condition,
  conditionSchema,
  type DecreeLimits,
} from "../core/decree";
import { addIssue, parseWith } from "../core/errors";
import type { Game } from "../core/game";
import { type UnlockId, unlockFor } from "../core/unlocks";

export type Reaction = { when: Condition; commands: Command[] };
/** A setup command may also wait for a condition, which it needs only once to be released. */
export type SetupStep = Command | { when: Condition; command: Command };
/** What a strategy sets up and buys in one posting. */
export type PostingPlan = {
  setup: SetupStep[];
  /** Archive entries bought in this order, after the ones the setup commands need, each as soon as it is on offer and affordable. An entry already owned is skipped, so one the posting reset is bought again. */
  purchases: string[];
};
export type LaterPosting = PostingPlan & {
  /** The doctrine the posting is begun under; the first the data lists when absent. */
  doctrine?: string | undefined;
};
export type Strategy = PostingPlan & {
  name: string;
  reactions: Reaction[];
  /**
   * The plans for the second posting onward, the last repeating for every posting after it. A strategy
   * with none never ends a posting; one with any ends each posting as soon as the crown allows.
   */
  laterPostings: LaterPosting[];
};
export type StrategyStats = {
  setupCommands: number;
  purchaseCommands: number;
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
  const setupStep = z.union([
    commandSchema,
    z.strictObject({ when: conditionSchema(limits), command: commandSchema }),
  ]);
  const postingPlan = {
    setup: z.array(setupStep),
    purchases: z.array(z.string()),
  };
  return z.strictObject({
    name: z.string().min(1),
    ...postingPlan,
    reactions: z.array(reaction),
    laterPostings: z
      .array(
        z.strictObject({ ...postingPlan, doctrine: z.string().optional() }),
      )
      .default([]),
  });
}

export function parseStrategy(value: unknown, limits: DecreeLimits): Strategy {
  return parseWith(strategySchema(limits), value, "strategy");
}

/** A setup command with a condition waits for it to hold once; after that it waits only for its unlock. */
type WaitingStep = { when: Condition | undefined; command: Command };

export class StrategyPlayer {
  private readonly held: boolean[];
  private waiting: WaitingStep[] = [];
  private purchases: UnlockId[] = [];
  private postingIndex = 0;
  private game: Game | undefined;
  private pending: Command[] = [];
  private purchase: Command[] = [];
  private readonly counts: StrategyStats = {
    setupCommands: 0,
    purchaseCommands: 0,
    reactionCommands: 0,
    actingTicks: 0,
    longestQuietTicks: 0,
  };
  private quiet = 0;

  constructor(private readonly strategy: Strategy) {
    this.held = strategy.reactions.map(() => false);
    this.beginPosting(1);
  }

  private get endsPostings(): boolean {
    return this.strategy.laterPostings.length > 0;
  }

  private planFor(index: number): LaterPosting {
    const { laterPostings } = this.strategy;
    if (index === 1 || laterPostings.length === 0) return this.strategy;
    return laterPostings[
      Math.min(index - 2, laterPostings.length - 1)
    ] as LaterPosting;
  }

  /** A posting begins from nothing, so setup that was never issued in the last one is dropped and every reaction waits for its condition afresh. */
  private beginPosting(index: number): void {
    const plan = this.planFor(index);
    this.postingIndex = index;
    this.held.fill(false);
    this.waiting = plan.setup.map((step) =>
      "command" in step
        ? { when: step.when, command: step.command }
        : { when: undefined, command: step },
    );
    this.purchases = [
      ...new Set([
        ...this.waiting.flatMap(({ command }) => {
          const needed = unlockFor(command.type);
          return needed === undefined ? [] : [needed];
        }),
        ...plan.purchases,
      ]),
    ];
  }

  private canIssue(command: Command): boolean {
    const needed = unlockFor(command.type);
    return needed === undefined || this.game?.unlocks.enabled(needed) === true;
  }

  next(): Command[] {
    const ready = this.waiting.filter(
      (step) => step.when === undefined && this.canIssue(step.command),
    );
    if (ready.length > 0) {
      this.waiting = this.waiting.filter((step) => !ready.includes(step));
    }
    const reactions = this.pending;
    this.counts.setupCommands += ready.length;
    this.counts.purchaseCommands += this.purchase.length;
    this.counts.reactionCommands += reactions.length;
    if (reactions.length > 0) {
      this.counts.actingTicks += 1;
      this.quiet = 0;
    } else {
      this.quiet += 1;
    }
    this.counts.longestQuietTicks = Math.max(
      this.counts.longestQuietTicks,
      this.quiet,
    );
    const handed = [
      ...ready.map(({ command }) => structuredClone(command)),
      ...this.purchase,
      ...reactions,
    ];
    this.pending = [];
    this.purchase = [];
    return handed;
  }

  observe(game: Game): void {
    this.game = game;
    if (game.state.posting.index !== this.postingIndex) {
      this.beginPosting(game.state.posting.index);
    }
    for (const step of this.waiting) {
      if (step.when !== undefined && game.conditions.evaluate(step.when, {})) {
        step.when = undefined;
      }
    }
    const fired: Command[] = [];
    for (const [index, reaction] of this.strategy.reactions.entries()) {
      const holds = game.conditions.evaluate(reaction.when, {});
      if (holds && !this.held[index]) {
        fired.push(
          ...reaction.commands
            .filter((command) => this.canIssue(command))
            .map((command) => structuredClone(command)),
        );
      }
      this.held[index] = holds;
    }
    if (this.endsPostings && game.prestige.canEnd) {
      const next = this.planFor(game.state.posting.index + 1);
      fired.push({
        type: "endPosting",
        name: game.prestige.defaultName,
        doctrine: next.doctrine ?? game.tuning.doctrines.entries[0]?.id ?? "",
      });
    }
    this.pending = fired;
    this.purchase = this.nextPurchase(game);
  }

  /** Purchases go in order, so the next one waits until it can be bought. */
  private nextPurchase(game: Game): Command[] {
    const id = this.purchases.find(
      (candidate) => !game.unlocks.enabled(candidate),
    );
    const entry = game.tuning.archive.entries.find(
      (candidate) => candidate.id === id,
    );
    return entry !== undefined && game.unlocks.canBuy(entry)
      ? [{ type: "buyUnlock", id: entry.id }]
      : [];
  }

  stats(): StrategyStats {
    return { ...this.counts };
  }
}
