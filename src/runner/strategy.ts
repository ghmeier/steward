import { type Command, parseCommand } from "../core/commands";
import { evaluateCondition } from "../core/conditions";
import { isRecord, sortedKeys } from "../core/data";
import {
	type Condition,
	type DecreeLimits,
	parseCondition,
} from "../core/decree";
import { errorMessage } from "../core/errors";
import type { GameState } from "../core/state";
import type { Tuning } from "../core/tuning";

export type Reaction = { when: Condition; commands: Command[] };
export type Strategy = {
	name: string;
	setup: Command[];
	reactions: Reaction[];
};
export type StrategyStats = {
	setupCommands: number;
	reactionCommands: number;
	actingTicks: number;
	longestQuietTicks: number;
};

const STRATEGY_KEYS = ["name", "reactions", "setup"];
const REACTION_KEYS = ["commands", "when"];

function expectKeys(
	value: unknown,
	path: string,
	keys: readonly string[],
): Record<string, unknown> {
	if (!isRecord(value)) throw new Error(`${path}: must be an object`);
	for (const key of keys) {
		if (!Object.hasOwn(value, key))
			throw new Error(`${path}.${key}: is missing`);
	}
	for (const key of sortedKeys(value)) {
		if (!keys.includes(key)) throw new Error(`${path}.${key}: unknown key`);
	}
	return value;
}

function parseCommands(value: unknown, path: string): Command[] {
	if (!Array.isArray(value)) throw new Error(`${path}: must be an array`);
	return value.map((raw, index) => {
		try {
			return parseCommand(raw);
		} catch (error) {
			throw new Error(`${path}[${index}]: ${errorMessage(error)}`);
		}
	});
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

export function parseStrategy(value: unknown, limits: DecreeLimits): Strategy {
	const object = expectKeys(value, "strategy", STRATEGY_KEYS);
	if (typeof object.name !== "string" || object.name === "") {
		throw new Error("strategy.name: must be a non-empty string");
	}
	const setup = parseCommands(object.setup, "strategy.setup");
	if (!Array.isArray(object.reactions)) {
		throw new Error("strategy.reactions: must be an array");
	}
	const reactions = object.reactions.map((raw, index): Reaction => {
		const path = `strategy.reactions[${index}]`;
		const reaction = expectKeys(raw, path, REACTION_KEYS);
		const when = parseCondition(reaction.when, limits, `${path}.when`);
		if (containsChose(when)) {
			throw new Error(
				`${path}.when: chose conditions are not available to strategies`,
			);
		}
		return {
			when,
			commands: parseCommands(reaction.commands, `${path}.commands`),
		};
	});
	return { name: object.name, setup, reactions };
}

export type StrategyPlayer = {
	next(): Command[];
	observe(state: GameState, tuning: Tuning): void;
	stats(): StrategyStats;
};

export function createStrategyPlayer(strategy: Strategy): StrategyPlayer {
	const held = strategy.reactions.map(() => false);
	let pending: Command[] = [];
	let started = false;
	let setupCommands = 0;
	let reactionCommands = 0;
	let actingTicks = 0;
	let quiet = 0;
	let longestQuietTicks = 0;

	const copy = (commands: readonly Command[]): Command[] =>
		commands.map((command) => structuredClone(command));

	return {
		next() {
			let handed: Command[];
			if (!started) {
				started = true;
				handed = copy(strategy.setup);
				setupCommands += handed.length;
				pending = [];
				quiet += 1;
			} else {
				handed = pending;
				pending = [];
				reactionCommands += handed.length;
				if (handed.length > 0) {
					actingTicks += 1;
					quiet = 0;
				} else {
					quiet += 1;
				}
			}
			longestQuietTicks = Math.max(longestQuietTicks, quiet);
			return handed;
		},
		observe(state, tuning) {
			const fired: Command[] = [];
			for (const [index, reaction] of strategy.reactions.entries()) {
				const holds = evaluateCondition(reaction.when, state, tuning, {});
				if (holds && !held[index]) fired.push(...copy(reaction.commands));
				held[index] = holds;
			}
			pending = fired;
		},
		stats: () => ({
			setupCommands,
			reactionCommands,
			actingTicks,
			longestQuietTicks,
		}),
	};
}
