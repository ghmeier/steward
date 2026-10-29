import { isRecord } from "./data";
import { enactDecree, repealDecree } from "./decree-engine";
import { errorMessage } from "./errors";
import { JOBS, type Job } from "./realm";
import type { GameState } from "./state";
import type { Tuning } from "./tuning";

export type Command =
	| { type: "noop" }
	| { type: "assignPeasant"; peasant: number; job: Job | "idle" }
	| { type: "enactDecree"; decree: unknown }
	| { type: "repealDecree"; id: string };

export type CommandResult = { ok: true } | { ok: false; reason: string };

/**
 * An entry with `tick: T` is applied during the step that advances `state.tick`
 * from T-1 to T. Commands never act when they arrive; the runner records the tick
 * the command will run in, and replay depends on nothing but that number.
 */
export type CommandLogEntry = { tick: number; command: Command };

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
	peasant.job = job;
	return { ok: true };
}

export function apply(
	state: GameState,
	command: Command,
	tuning: Tuning,
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
	if (!isRecord(value)) throw new Error("command must be an object");
	const type = value.type;
	switch (type) {
		case "noop":
			return { type: "noop" };
		case "assignPeasant": {
			const peasant = value.peasant;
			if (typeof peasant !== "number" || !Number.isSafeInteger(peasant)) {
				throw new Error("assignPeasant peasant must be an integer");
			}
			const job = value.job;
			if (
				typeof job !== "string" ||
				!(job === "idle" || (JOBS as readonly string[]).includes(job))
			) {
				throw new Error(
					`assignPeasant job must be one of ${JOBS.join(", ")}, idle`,
				);
			}
			return { type: "assignPeasant", peasant, job: job as Job | "idle" };
		}
		case "enactDecree": {
			if (!isRecord(value.decree)) {
				throw new Error("enactDecree decree must be an object");
			}
			return { type: "enactDecree", decree: value.decree };
		}
		case "repealDecree": {
			if (typeof value.id !== "string") {
				throw new Error("repealDecree id must be a string");
			}
			return { type: "repealDecree", id: value.id };
		}
		default:
			throw new Error(`unknown command type ${JSON.stringify(type)}`);
	}
}

export function parseCommandLog(value: unknown): CommandLogEntry[] {
	if (!Array.isArray(value)) throw new Error("command log must be an array");
	const entries: CommandLogEntry[] = [];
	let previousTick = 1;
	for (const [index, raw] of value.entries()) {
		if (!isRecord(raw)) {
			throw new Error(`command log entry ${index} must be an object`);
		}
		const tick = raw.tick;
		if (typeof tick !== "number" || !Number.isInteger(tick) || tick < 1) {
			throw new Error(
				`command log entry ${index} tick must be a positive integer`,
			);
		}
		if (tick < previousTick) {
			throw new Error(
				`command log entry ${index} tick ${tick} is lower than the previous tick ${previousTick}`,
			);
		}
		previousTick = tick;
		let command: Command;
		try {
			command = parseCommand(raw.command);
		} catch (error) {
			throw new Error(`command log entry ${index}: ${errorMessage(error)}`);
		}
		entries.push({ tick, command });
	}
	return entries;
}
