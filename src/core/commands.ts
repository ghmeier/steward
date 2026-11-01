import { isRecord } from "./data";
import { enactDecree, repealDecree } from "./decree-engine";
import { settleDispute } from "./desk";
import { errorMessage } from "./errors";
import type { AddContext } from "./math";
import { JOBS, type Job } from "./realm";
import { enactSaved, forgetSaved, saveDecree } from "./saved-decrees";
import type { GameState } from "./state";
import type { Tuning } from "./tuning";
import { buyUnlock } from "./unlocks";

export type Command =
	| { type: "noop" }
	| { type: "assignPeasant"; peasant: number; job: Job | "idle" }
	| { type: "enactDecree"; decree: unknown }
	| { type: "repealDecree"; id: string }
	| { type: "settleDispute"; dispute: number; option: string }
	| { type: "buyUnlock"; id: string }
	| { type: "saveDecree"; name: string; decree: unknown }
	| { type: "enactSaved"; name: string }
	| { type: "forgetSaved"; name: string };

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
		case "settleDispute": {
			const dispute = value.dispute;
			if (typeof dispute !== "number" || !Number.isSafeInteger(dispute)) {
				throw new Error("settleDispute dispute must be an integer");
			}
			if (typeof value.option !== "string") {
				throw new Error("settleDispute option must be a string");
			}
			return { type: "settleDispute", dispute, option: value.option };
		}
		case "buyUnlock": {
			if (typeof value.id !== "string") {
				throw new Error("buyUnlock id must be a string");
			}
			return { type: "buyUnlock", id: value.id };
		}
		case "saveDecree": {
			if (typeof value.name !== "string") {
				throw new Error("saveDecree name must be a string");
			}
			if (!isRecord(value.decree)) {
				throw new Error("saveDecree decree must be an object");
			}
			return { type: "saveDecree", name: value.name, decree: value.decree };
		}
		case "enactSaved": {
			if (typeof value.name !== "string") {
				throw new Error("enactSaved name must be a string");
			}
			return { type: "enactSaved", name: value.name };
		}
		case "forgetSaved": {
			if (typeof value.name !== "string") {
				throw new Error("forgetSaved name must be a string");
			}
			return { type: "forgetSaved", name: value.name };
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
