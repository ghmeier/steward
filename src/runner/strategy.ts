import { type Command, commandSchema } from "../core/commands";
import { evaluateCondition } from "../core/conditions";
import {
	type Condition,
	conditionSchema,
	type DecreeLimits,
} from "../core/decree";
import {
	array,
	object,
	parse,
	refine,
	type Schema,
	string,
} from "../core/schema";
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

function strategySchema(limits: DecreeLimits): Schema<Strategy> {
	const commands = array(commandSchema);
	const reaction = refine(
		object({ when: conditionSchema(limits), commands }),
		(entry, path, problems) => {
			if (containsChose(entry.when)) {
				problems.push(
					`${path}.when: chose conditions are not available to strategies`,
				);
			}
		},
	);
	return object({
		name: string({ nonEmpty: true }),
		setup: commands,
		reactions: array(reaction),
	});
}

export function parseStrategy(value: unknown, limits: DecreeLimits): Strategy {
	return parse(strategySchema(limits), value, "strategy");
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
