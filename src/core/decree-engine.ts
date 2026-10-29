import type { CommandResult } from "./commands";
import { sortedKeys } from "./data";
import {
	type Condition,
	type Decree,
	decreeReferences,
	decreeSetProblem,
	formatCycle,
	HARVEST_POLICIES,
	orderDecrees,
	type Petition,
	parseDecree,
	type Quantity,
} from "./decree";
import { idleCount } from "./delegates";
import {
	type EconomyFlows,
	feedGrain,
	grainSeasons,
	laborTargets,
	moveLaborToward,
	seasonAt,
	sellGrain,
} from "./economy";
import { errorMessage } from "./errors";
import type { AddContext } from "./math";
import type { GameState } from "./state";
import type { Tuning } from "./tuning";

export { HARVEST_POLICIES } from "./decree";

export function policiesFor(
	petition: Petition,
	tuning: Tuning,
): readonly string[] {
	return petition === "harvest"
		? HARVEST_POLICIES
		: sortedKeys(tuning.economy.laborAllocations);
}

export function quantityValue(
	quantity: Quantity,
	state: GameState,
	tuning: Tuning,
): number {
	const { resources, delegates } = state.posting;
	switch (quantity) {
		case "coin":
		case "grain":
		case "ore":
		case "wood":
			return resources[quantity] ?? 0;
		case "population":
			return delegates.length;
		case "idle":
			return idleCount(delegates);
		case "grainSeasons":
			return grainSeasons(state, tuning);
	}
}

export function evaluateCondition(
	condition: Condition,
	state: GameState,
	tuning: Tuning,
	chosen: Readonly<Record<string, string>>,
): boolean {
	switch (condition.kind) {
		case "compare": {
			const value = quantityValue(condition.quantity, state, tuning);
			return condition.comparison === "above"
				? value > condition.value
				: value < condition.value;
		}
		case "season":
			return (
				seasonAt(state.tick, tuning.economy.ticksPerSeason) === condition.season
			);
		case "chose":
			return (
				Object.hasOwn(chosen, condition.decree) &&
				chosen[condition.decree] === condition.policy
			);
		case "all":
			return condition.conditions.every((child) =>
				evaluateCondition(child, state, tuning, chosen),
			);
		case "any":
			return condition.conditions.some((child) =>
				evaluateCondition(child, state, tuning, chosen),
			);
		case "not":
			return !evaluateCondition(condition.condition, state, tuning, chosen);
	}
}

export function enactDecree(
	state: GameState,
	value: unknown,
	tuning: Tuning,
): CommandResult {
	let decree: Decree;
	try {
		decree = parseDecree(value, tuning.decrees);
	} catch (error) {
		return { ok: false, reason: errorMessage(error) };
	}

	const candidate: Record<string, Decree> = {
		...state.posting.decrees,
		[decree.id]: decree,
	};
	const problem = decreeSetProblem(
		candidate,
		policiesFor("labor", tuning),
		decree.id,
	);
	if (problem !== null) return { ok: false, reason: problem };

	state.posting.decrees[decree.id] = decree;
	return { ok: true };
}

export function repealDecree(state: GameState, id: string): CommandResult {
	const decrees = state.posting.decrees;
	if (!Object.hasOwn(decrees, id)) {
		return { ok: false, reason: `no active decree "${id}"` };
	}
	for (const other of sortedKeys(decrees)) {
		const decree = decrees[other];
		if (other !== id && decree && decreeReferences(decree).includes(id)) {
			return { ok: false, reason: `decree "${other}" references "${id}"` };
		}
	}
	delete decrees[id];
	return { ok: true };
}

export function runDecrees(
	state: GameState,
	tuning: Tuning,
	context: AddContext,
	flows: EconomyFlows,
): Record<string, string> {
	const decrees = state.posting.decrees;
	const order = orderDecrees(decrees);
	if (!order.ok) {
		throw new Error(`active decrees form a cycle: ${formatCycle(order.cycle)}`);
	}

	const chosen: Record<string, string> = {};
	for (const id of order.order) {
		const decree = decrees[id];
		if (!decree) continue;
		const matched = decree.rules.find((rule) =>
			evaluateCondition(rule.when, state, tuning, chosen),
		);
		const policy = matched ? matched.policy : decree.otherwise;
		chosen[id] = policy;

		if (decree.petition === "harvest") {
			if (policy === "sell") {
				sellGrain(state, flows.grainSurplus, tuning, context);
			} else if (policy === "feed") {
				feedGrain(state, flows.grainSurplus, tuning, context);
			} else if (policy !== "stockpile") {
				throw new Error(`unknown harvest policy "${policy}"`);
			}
		} else {
			const allocations = tuning.economy.laborAllocations;
			const shares = Object.hasOwn(allocations, policy)
				? allocations[policy]
				: undefined;
			if (!shares) throw new Error(`unknown labor policy "${policy}"`);
			moveLaborToward(
				state.posting.delegates,
				laborTargets(state.posting.delegates.length, shares),
				tuning.economy.laborMovesPerTick,
				state.tick,
			);
		}
	}
	return chosen;
}
