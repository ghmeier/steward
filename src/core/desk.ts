import type { CommandResult } from "./commands";
import { sortedKeys } from "./data";
import type { Delegate } from "./delegates";
import type { AddContext } from "./math";
import { add } from "./math";
import type { Resource } from "./realm";
import { intBelow, type RngState } from "./rng";
import type { GameState } from "./state";
import type { DisputeOption, DisputeTemplate, Tuning } from "./tuning";

export type Dispute = {
	id: number;
	template: string;
	parties: [number, number];
	arrivedAt: number;
};

/** Disputes are oldest first. */
export type DeskState = {
	nextDisputeId: number;
	nextArrivalTick: number;
	disputes: Dispute[];
};

function disputeStream(state: GameState): RngState {
	const stream = state.posting.rng.disputes;
	if (stream === undefined) throw new Error("the disputes stream is missing");
	return stream;
}

/** Ticks until the next arrival, in [minTicks, maxTicks]; the caller adds the current tick. */
export function drawArrivalDelay(stream: RngState, tuning: Tuning): number {
	const { minTicks, maxTicks } = tuning.village.disputeArrival;
	return minTicks + intBelow(stream, maxTicks - minTicks + 1);
}

export function templateOf(dispute: Dispute, tuning: Tuning): DisputeTemplate {
	const template = tuning.village.disputes.find(
		(candidate) => candidate.id === dispute.template,
	);
	if (template === undefined) {
		throw new Error(
			`dispute ${dispute.id} uses unknown template "${dispute.template}"; the village content changed under this save`,
		);
	}
	return template;
}

function optionOf(
	template: DisputeTemplate,
	optionId: string,
): DisputeOption | undefined {
	return template.options.find((option) => option.id === optionId);
}

export function fillNames(text: string, first: string, second: string): string {
	return text.replaceAll("{first}", first).replaceAll("{second}", second);
}

// Floored so a village holding 4.96 against a need of 5 is never described as having 5.
function show(amount: number): string {
	return String(Math.floor(amount * 10) / 10);
}

/** Names the first resource the village cannot cover, or null when the option is affordable. */
export function shortfall(
	state: GameState,
	option: DisputeOption,
): string | null {
	const resources = option.resources ?? {};
	for (const resource of sortedKeys(resources)) {
		const delta = resources[resource as Resource] ?? 0;
		const held = state.posting.resources[resource] ?? 0;
		if (held + delta < 0) {
			return `not enough ${resource} (need ${show(-delta)}, have ${show(held)})`;
		}
	}
	return null;
}

function applyResources(
	state: GameState,
	option: DisputeOption,
	context: AddContext,
	clampLosses: boolean,
): void {
	const resources = option.resources ?? {};
	for (const resource of sortedKeys(resources)) {
		let delta = resources[resource as Resource] ?? 0;
		if (clampLosses) {
			delta = Math.max(delta, -(state.posting.resources[resource] ?? 0));
		}
		add(state.posting.resources, resource, delta, context);
	}
}

export function settleDispute(
	state: GameState,
	disputeId: number,
	optionId: string,
	tuning: Tuning,
	context: AddContext,
): CommandResult {
	const disputes = state.posting.desk.disputes;
	const index = disputes.findIndex((candidate) => candidate.id === disputeId);
	const dispute = disputes[index];
	if (dispute === undefined) {
		return { ok: false, reason: `no dispute ${disputeId}` };
	}
	const template = templateOf(dispute, tuning);
	const option = optionOf(template, optionId);
	if (option === undefined) {
		return {
			ok: false,
			reason: `dispute ${disputeId} has no option "${optionId}"`,
		};
	}
	const problem = shortfall(state, option);
	if (problem !== null) return { ok: false, reason: problem };

	applyResources(state, option, context, false);
	if (option.grudge !== undefined) {
		const party = dispute.parties[option.grudge === "first" ? 0 : 1];
		const peasant = state.posting.delegates.find(
			(delegate: Delegate) => delegate.id === party,
		);
		if (peasant !== undefined) {
			peasant.grudgeUntil = Math.max(
				peasant.grudgeUntil,
				state.tick + tuning.village.grudgeTicks,
			);
		}
	}
	disputes.splice(index, 1);
	return { ok: true };
}

function drawDispute(state: GameState, tuning: Tuning): void {
	const { desk, delegates } = state.posting;
	const stream = disputeStream(state);
	const templates = tuning.village.disputes;
	const template = templates[intBelow(stream, templates.length)];
	const firstIndex = intBelow(stream, delegates.length);
	const drawn = intBelow(stream, delegates.length - 1);
	const secondIndex = drawn >= firstIndex ? drawn + 1 : drawn;
	const first = delegates[firstIndex];
	const second = delegates[secondIndex];
	if (template === undefined || first === undefined || second === undefined) {
		throw new Error("dispute draw landed outside its range");
	}
	desk.disputes.push({
		id: desk.nextDisputeId,
		template: template.id,
		parties: [first.id, second.id],
		arrivedAt: state.tick,
	});
	desk.nextDisputeId += 1;
}

export function runDesk(
	state: GameState,
	tuning: Tuning,
	context: AddContext,
): void {
	const { desk, delegates } = state.posting;
	for (const dispute of desk.disputes) templateOf(dispute, tuning);

	const living = new Set(delegates.map((delegate) => delegate.id));
	desk.disputes = desk.disputes.filter((dispute) =>
		dispute.parties.every((party) => living.has(party)),
	);

	if (state.tick >= desk.nextArrivalTick) {
		if (delegates.length >= 2) drawDispute(state, tuning);
		desk.nextArrivalTick =
			state.tick + drawArrivalDelay(disputeStream(state), tuning);
	}

	while (desk.disputes.length > tuning.village.deskSlots) {
		const oldest = desk.disputes.shift();
		if (oldest === undefined) break;
		const template = templateOf(oldest, tuning);
		const option = optionOf(template, template.expiry);
		if (option === undefined) throw new Error("expiry option is missing");
		applyResources(state, option, context, true);
	}
}
