import { isRecord } from "./data";
import { enactDecree, repealDecree } from "./decree-engine";
import { settleDispute } from "./desk";
import type { AddContext } from "./math";
import { JOBS, type Job } from "./realm";
import { enactSaved, forgetSaved, saveDecree } from "./saved-decrees";
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
import type { GameState } from "./state";
import type { Tuning } from "./tuning";
import { buyUnlock } from "./unlocks";

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
		job: literal(...JOBS, "idle"),
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

function assignPeasant(
	state: GameState,
	peasantId: number,
	job: Job | "idle",
): CommandResult {
	const peasant = state.posting.delegates.find(
		(delegate) => delegate.id === peasantId,
	);
	if (peasant === undefined) {
		return { ok: false, reason: `no peasant ${peasantId}` };
	}
	if (peasant.job === job) {
		return {
			ok: false,
			reason:
				job === "idle"
					? `${peasant.name} is already idle`
					: `${peasant.name} already works the ${job}`,
		};
	}
	if (job !== "idle" && state.tick < peasant.grudgeUntil) {
		return { ok: false, reason: `${peasant.name} refuses to work (grudge)` };
	}
	peasant.job = job;
	return { ok: true };
}

export function apply(
	state: GameState,
	command: Command,
	tuning: Tuning,
	context: AddContext,
): CommandResult {
	switch (command.type) {
		case "noop":
			return { ok: true };
		case "assignPeasant":
			return assignPeasant(state, command.peasant, command.job);
		case "enactDecree":
			return enactDecree(state, command.decree, tuning);
		case "repealDecree":
			return repealDecree(state, command.id);
		case "settleDispute":
			return settleDispute(
				state,
				command.dispute,
				command.option,
				tuning,
				context,
			);
		case "buyUnlock":
			return buyUnlock(state, command.id, tuning, context);
		case "saveDecree":
			return saveDecree(state, command.name, command.decree, tuning);
		case "enactSaved":
			return enactSaved(state, command.name, tuning);
		case "forgetSaved":
			return forgetSaved(state, command.name);
		default: {
			const unreachable: never = command;
			return {
				ok: false,
				reason: `unknown command ${JSON.stringify(unreachable)}`,
			};
		}
	}
}

export function parseCommand(value: unknown): Command {
	return parse(commandSchema, value, "command");
}

export function parseCommandLog(value: unknown): CommandLogEntry[] {
	return parse(commandLogSchema, value, "command log");
}
