import type { CommandResult } from "./commands";
import { evaluateCondition } from "./conditions";
import { compareKeys, sortedKeys } from "./data";
import {
	type Condition,
	choseConditions,
	type Decree,
	decreePolicyProblem,
	decreeReferences,
	decreeSetProblem,
	formatCycle,
	HARVEST_POLICIES,
	orderDecrees,
	PETITION_RESOURCE,
	type Petition,
	parseDecree,
	type ResourcePetition,
	STORE_POLICIES,
} from "./decree";
import {
	type EconomyFlows,
	feedGrain,
	laborTargets,
	moveLaborToward,
	sellResource,
} from "./economy";
import { errorMessage } from "./errors";
import type { AddContext } from "./math";
import type { GameState } from "./state";
import type { Tuning } from "./tuning";
import { missingDecreeUnlock, missingDecreeUnlockReason } from "./unlocks";

export { HARVEST_POLICIES } from "./decree";

export function policiesFor(
	petition: Petition,
	tuning: Tuning,
): readonly string[] {
	if (petition === "harvest") return HARVEST_POLICIES;
	if (petition === "labor") return sortedKeys(tuning.economy.laborAllocations);
	return STORE_POLICIES;
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

	const missing = missingDecreeUnlock(state, decree, tuning);
	if (missing !== null) {
		return { ok: false, reason: missingDecreeUnlockReason(missing) };
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

/**
 * Labor policies come from tuning, which state validation cannot see, so a save can hold a labor
 * decree whose allocation has since been removed. Dropping those, and any decree that chains on
 * a dropped one, keeps the remaining set runnable instead of failing on the next step.
 */
export function repealStaleDecrees(state: GameState, tuning: Tuning): string[] {
	const decrees = state.posting.decrees;
	const removed = new Set<string>();
	// A chose test on a policy its target can no longer choose would fail every later enactment.
	const isStale = (decree: Decree): boolean =>
		decreePolicyProblem(decree, policiesFor(decree.petition, tuning)) !==
			null ||
		choseConditions(decree).some((test) => {
			const target = Object.hasOwn(decrees, test.decree)
				? decrees[test.decree]
				: undefined;
			return (
				target !== undefined &&
				!policiesFor(target.petition, tuning).includes(test.policy)
			);
		});
	for (const id of sortedKeys(decrees)) {
		const decree = decrees[id];
		if (decree && isStale(decree)) removed.add(id);
	}
	let grew = removed.size > 0;
	while (grew) {
		grew = false;
		for (const id of sortedKeys(decrees)) {
			const decree = decrees[id];
			if (
				decree &&
				!removed.has(id) &&
				decreeReferences(decree).some((ref) => removed.has(ref))
			) {
				removed.add(id);
				grew = true;
			}
		}
	}
	const ids = [...removed].sort(compareKeys);
	for (const id of ids) delete decrees[id];
	return ids;
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
