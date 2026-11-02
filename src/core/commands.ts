import { z } from "zod";
import { addIssue, parseWith } from "./errors";
import type { Game } from "./game";
import type { AddContext } from "./math";
import { JOBS } from "./realm";

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

export type CommandResult = { ok: true } | { ok: false; reason: string };

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
