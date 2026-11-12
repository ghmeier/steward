import { z } from "zod";
import { DESK_KINDS } from "./desk";
import { addIssue, parseWith } from "./errors";
import type { Game } from "./game";
import type { AddContext } from "./math";
import { JOBS, RESOURCES } from "./realm";

const text = z.string();

// The decree is judged only when enacted or saved, against the tuning in force then.
const opaqueDecree = z
  .record(z.string(), z.unknown())
  .transform((value): unknown => structuredClone(value));

export const commandSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("noop") }),
  z.strictObject({
    type: z.literal("assignPeasant"),
    peasant: z.int(),
    job: z.enum(JOBS),
  }),
  z.strictObject({ type: z.literal("enactDecree"), decree: opaqueDecree }),
  z.strictObject({ type: z.literal("repealDecree"), id: text }),
  z.strictObject({
    type: z.literal("settleDispute"),
    dispute: z.int(),
    option: text,
  }),
  z.strictObject({
    type: z.literal("settle"),
    kind: z.enum(DESK_KINDS),
    option: text,
  }),
  z.strictObject({ type: z.literal("deliver") }),
  z.strictObject({
    type: z.literal("conjure"),
    resource: z.enum(RESOURCES),
    amount: z.number(),
  }),
  z.strictObject({ type: z.literal("forge") }),
  z.strictObject({ type: z.literal("forgeMissing") }),
  z.strictObject({ type: z.literal("back"), resource: z.enum(RESOURCES) }),
  z.strictObject({ type: z.literal("buyUnlock"), id: text }),
  z.strictObject({
    type: z.literal("saveDecree"),
    name: text,
    decree: opaqueDecree,
  }),
  z.strictObject({ type: z.literal("enactSaved"), name: text }),
  z.strictObject({ type: z.literal("forgetSaved"), name: text }),
]);

export type Command = z.infer<typeof commandSchema>;

/** A command that worked may carry a line telling the steward what it did. */
export type CommandResult =
  | { ok: true; message?: string }
  | { ok: false; reason: string };

/**
 * An entry with `tick: T` is applied during the step that advances `state.tick`
 * from T-1 to T. Commands never act when they arrive; the runner records the tick
 * the command will run in, and replay depends on nothing but that number.
 */
export type CommandLogEntry = { tick: number; command: Command };

const commandLogSchema: z.ZodType<CommandLogEntry[]> = z
  .array(z.strictObject({ tick: z.int().min(1), command: commandSchema }))
  .superRefine((entries, ctx) => {
    let previousTick = 1;
    for (const [index, entry] of entries.entries()) {
      if (entry.tick < previousTick) {
        addIssue(
          ctx,
          `${entry.tick} is lower than the previous tick ${previousTick}`,
          [index, "tick"],
        );
      }
      previousTick = entry.tick;
    }
  });

export class CommandManager {
  constructor(private game: Game) {}

  apply(command: Command, context: AddContext): CommandResult {
    try {
      switch (command.type) {
        case "noop":
          return { ok: true };
        case "assignPeasant":
          this.game.delegates.assignJob(command.peasant, command.job);
          this.game.labor.stop();
          return { ok: true };
        case "enactDecree":
          this.game.decrees.enact(command.decree);
          return { ok: true };
        case "repealDecree":
          this.game.decrees.repeal(command.id);
          return { ok: true };
        case "settleDispute":
          return this.game.desk.settle(
            command.dispute,
            command.option,
            context,
          );
        case "settle":
          return this.game.desk.settleOldest(
            command.kind,
            command.option,
            context,
          );
        case "deliver":
          return this.game.crown.deliver(context);
        case "conjure":
          return this.game.illusion.conjure(command.resource, command.amount);
        case "forge":
          return this.game.illusion.forge(context);
        case "forgeMissing":
          return this.game.illusion.forgeMissing(context);
        case "back":
          return this.game.illusion.back(command.resource, context);
        case "buyUnlock":
          this.game.unlocks.buy(command.id, context);
          return { ok: true };
        case "saveDecree":
          this.game.savedDecrees.save(command.name, command.decree);
          return { ok: true };
        case "enactSaved":
          this.game.savedDecrees.enact(command.name);
          return { ok: true };
        case "forgetSaved":
          this.game.savedDecrees.forget(command.name);
          return { ok: true };
        default: {
          const unreachable: never = command;
          return {
            ok: false,
            reason: `unknown command ${JSON.stringify(unreachable)}`,
          };
        }
      }
    } catch (err) {
      if (!(err instanceof Error)) throw err;
      return { ok: false, reason: err.message };
    }
  }

  parseCommand(value: unknown): Command {
    return parseWith(commandSchema, value, "command");
  }
  parseCommandLog(value: unknown): CommandLogEntry[] {
    return parseWith(commandLogSchema, value, "command log");
  }
}
