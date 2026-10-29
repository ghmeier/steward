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
	PETITION_RESOURCE,
	type Petition,
	parseDecree,
	type Quantity,
	type ResourcePetition,
	STORE_POLICIES,
} from "./decree";
import { idleCount } from "./delegates";
import {
	type EconomyFlows,
	feedGrain,
	grainSeasons,
	laborTargets,
	moveLaborToward,
	seasonAt,
	sellResource,
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
	if (petition === "harvest") return HARVEST_POLICIES;
	if (petition === "labor") return sortedKeys(tuning.economy.laborAllocations);
	return STORE_POLICIES;
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

// A bare "resource above N" rule means everything over N, not just this tick's production.
function resourceAmount(
	state: GameState,
	resource: (typeof PETITION_RESOURCE)[ResourcePetition],
	when: Condition | undefined,
	produced: number,
): number {
	const stock = state.posting.resources[resource] ?? 0;
	if (
		when?.kind === "compare" &&
		when.comparison === "above" &&
		when.quantity === resource
	) {
		return Math.max(0, stock - Math.max(0, when.value));
	}
	return Math.min(produced, stock);
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

		if (decree.petition !== "labor") {
			const resource = PETITION_RESOURCE[decree.petition];
			const amount = resourceAmount(
				state,
				resource,
				matched?.when,
				flows[decree.petition],
			);
			if (policy === "sell") {
				sellResource(state, resource, amount, tuning, context);
			} else if (policy === "feed" && decree.petition === "harvest") {
				feedGrain(state, amount, tuning, context);
			} else if (policy !== "stockpile") {
				throw new Error(`unknown ${decree.petition} policy "${policy}"`);
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
