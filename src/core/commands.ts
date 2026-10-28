import { isRecord } from "./data";
import { idlePeasants } from "./economy";
import { errorMessage } from "./errors";
import { JOBS, type Job } from "./realm";
import type { GameState } from "./state";
import type { Tuning } from "./tuning";

export type Command =
	| { type: "noop" }
	| { type: "assignWorker"; job: Job; delta: number };

export type CommandResult = { ok: true } | { ok: false; reason: string };

/**
 * An entry with `tick: T` is applied during the step that advances `state.tick`
 * from T-1 to T. Commands never act when they arrive; the runner records the tick
 * the command will run in, and replay depends on nothing but that number.
 */
export type CommandLogEntry = { tick: number; command: Command };

function assignWorker(
	state: GameState,
	job: Job,
	delta: number,
): CommandResult {
	if (delta !== 1 && delta !== -1) {
		return { ok: false, reason: "delta must be 1 or -1" };
	}
	const economy = state.posting.economy;
	if (delta === 1) {
		if (idlePeasants(economy) <= 0) {
			return { ok: false, reason: "no idle peasants" };
		}
	} else if (economy.labor[job] <= 0) {
		return { ok: false, reason: `no peasants work the ${job}` };
	}
	economy.labor[job] += delta;
	return { ok: true };
}

export function apply(
	state: GameState,
	command: Command,
	_tuning: Tuning,
): CommandResult {
	switch (command.type) {
		case "noop":
			return { ok: true };
		case "assignWorker":
			return assignWorker(state, command.job, command.delta);
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
		case "assignWorker": {
			const job = value.job;
			if (
				typeof job !== "string" ||
				!(JOBS as readonly string[]).includes(job)
			) {
				throw new Error(`assignWorker job must be one of ${JOBS.join(", ")}`);
			}
			const delta = value.delta;
			if (typeof delta !== "number" || !Number.isFinite(delta)) {
				throw new Error("assignWorker delta must be a finite number");
			}
			return { type: "assignWorker", job: job as Job, delta };
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
