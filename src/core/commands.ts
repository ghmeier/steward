import { normalizeZero } from "./math";
import type { GameState } from "./state";
import type { Tuning } from "./tuning";

export type Command =
	| { type: "noop" }
	| { type: "setToyRate"; growthPerTick: number };

export type CommandResult = { ok: true } | { ok: false; reason: string };

/**
 * An entry with `tick: T` is applied during the step that advances `state.tick`
 * from T-1 to T. Commands never act when they arrive; the runner records the tick
 * the command will run in, and replay depends on nothing but that number.
 */
export type CommandLogEntry = { tick: number; command: Command };

export function apply(
	state: GameState,
	command: Command,
	tuning: Tuning,
): CommandResult {
	switch (command.type) {
		case "noop":
			return { ok: true };
		case "setToyRate": {
			const rate = command.growthPerTick;
			if (typeof rate !== "number" || !Number.isFinite(rate)) {
				return { ok: false, reason: "growthPerTick must be a finite number" };
			}
			if (rate < 0 || rate > tuning.maxResourceValue) {
				return {
					ok: false,
					reason: `growthPerTick must be between 0 and ${tuning.maxResourceValue}`,
				};
			}
			state.posting.toy.growthPerTick = normalizeZero(rate);
			return { ok: true };
		}
		default: {
			const unreachable: never = command;
			return {
				ok: false,
				reason: `unknown command ${JSON.stringify(unreachable)}`,
			};
		}
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseCommand(value: unknown): Command {
	if (!isRecord(value)) throw new Error("command must be an object");
	const type = value.type;
	switch (type) {
		case "noop":
			return { type: "noop" };
		case "setToyRate": {
			if (!Object.hasOwn(value, "growthPerTick")) {
				throw new Error("setToyRate command is missing growthPerTick");
			}
			const growthPerTick = value.growthPerTick;
			if (
				typeof growthPerTick !== "number" ||
				!Number.isFinite(growthPerTick)
			) {
				throw new Error("setToyRate growthPerTick must be a finite number");
			}
			return { type: "setToyRate", growthPerTick };
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
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`command log entry ${index}: ${message}`);
		}
		entries.push({ tick, command });
	}
	return entries;
}
