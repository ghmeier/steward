import { isRecord } from "./data";
import type { Game } from "./game";
import type { AddContext } from "./math";
import { JOBS } from "./realm";
import {
  array,
  custom,
  type Infer,
  integer,
  literal,
  object,
  parse,
  refine,
  type Schema,
  string,
  variant,
} from "./schema";

const text = string();

// The decree is judged only when enacted or saved, against the tuning in force then.
const opaqueDecree = custom<unknown>((value) => {
  if (!isRecord(value)) throw new Error("the decree must be an object");
  return structuredClone(value);
});

export const commandSchema = variant("type", {
  noop: object({ type: literal("noop") }),
  assignPeasant: object({
    type: literal("assignPeasant"),
    peasant: integer(),
    job: literal(...JOBS),
  }),
  enactDecree: object({ type: literal("enactDecree"), decree: opaqueDecree }),
  repealDecree: object({ type: literal("repealDecree"), id: text }),
  settleDispute: object({
    type: literal("settleDispute"),
    dispute: integer(),
    option: text,
  }),
  buyUnlock: object({ type: literal("buyUnlock"), id: text }),
  saveDecree: object({
    type: literal("saveDecree"),
    name: text,
    decree: opaqueDecree,
  }),
  enactSaved: object({ type: literal("enactSaved"), name: text }),
  forgetSaved: object({ type: literal("forgetSaved"), name: text }),
});

export type Command = Infer<typeof commandSchema>;

export type CommandResult = { ok: true } | { ok: false; reason: string };

/**
 * An entry with `tick: T` is applied during the step that advances `state.tick`
 * from T-1 to T. Commands never act when they arrive; the runner records the tick
 * the command will run in, and replay depends on nothing but that number.
 */
export type CommandLogEntry = { tick: number; command: Command };

const commandLogSchema: Schema<CommandLogEntry[]> = refine(
  array(object({ tick: integer({ min: 1 }), command: commandSchema })),
  (entries, path, problems) => {
    let previousTick = 1;
    for (const [index, entry] of entries.entries()) {
      if (entry.tick < previousTick) {
        problems.push(
          `${path}[${index}].tick: ${entry.tick} is lower than the previous tick ${previousTick}`,
        );
      }
      previousTick = entry.tick;
    }
  },
);

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
    return parse(commandSchema, value, "command");
  }
  parseCommandLog(value: unknown): CommandLogEntry[] {
    return parse(commandLogSchema, value, "command log");
  }
}
