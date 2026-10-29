import { compareKeys, sortedKeys } from "./data";
import type { Decree } from "./decree";
import { idleCount, laborCounts } from "./delegates";
import { fillNames, shortfall, templateOf } from "./desk";
import { seasonAt, steadyRates } from "./economy";
import { type Job, RESOURCES, type Season } from "./realm";
import type { GameState, ResourceId } from "./state";
import type { Tuning } from "./tuning";

export type LedgerLine = {
	resource: ResourceId;
	amount: number;
	ratePerSecond: number;
};
export type DeskOptionView = {
	id: string;
	label: string;
	affordable: boolean;
	expiry: boolean;
	/** Resource deltas, keys sorted. */
	resources: Record<string, number>;
	/** Which party will sulk if this option is chosen. */
	grudge: "first" | "second" | "none";
};
export type DeskEntryView = {
	id: number;
	label: string;
	/** Names of the two parties, so an option's grudge can be shown by name. */
	parties: [string, string];
	options: DeskOptionView[];
};
export type GovernorView = { id: string; name: string };
export type DelegateView = {
	id: number;
	name: string;
	job: Job | "idle";
	grudgeTicks: number;
};
export type PanelId = "crown" | "desk" | "ledger" | "peasants";
export type CrownDemandView = { label: string };
export type GameView = {
	tick: number;
	elapsedSeconds: number;
	ledger: LedgerLine[];
	realm: {
		population: number;
		idle: number;
		labor: Record<Job, number>;
		season: Season;
	};
	delegates: DelegateView[];
	decrees: Decree[];
	desk: DeskEntryView[];
	governors: GovernorView[];
	crown: CrownDemandView | null;
	promotion: { target: number; promotedAt: number; promotedAtSeconds: number };
	lockedPanels: PanelId[];
};

// The village answers to no crown until promotion is acted on in phase 8; phase 5 moves this list
// into the unlock registry.
const LOCKED_PANELS: readonly PanelId[] = ["crown"];

// The view is plain truth only in phase 2. Illusion, governor exaggeration and
// unlock filtering are applied here in later phases, so the UI must never read
// GameState directly.
export function computeView(state: GameState, tuning: Tuning): GameView {
	const rates = steadyRates(state, tuning);
	const ledger: LedgerLine[] = RESOURCES.map((resource) => ({
		resource,
		amount: state.posting.resources[resource] ?? 0,
		ratePerSecond: (rates[resource] * 1000) / tuning.stepMs,
	}));
	const { delegates, decrees } = state.posting;
	return {
		tick: state.tick,
		elapsedSeconds: (state.tick * tuning.stepMs) / 1000,
		ledger,
		realm: {
			population: delegates.length,
			idle: idleCount(delegates),
			labor: laborCounts(delegates),
			season: seasonAt(state.tick, tuning.economy.ticksPerSeason),
		},
		delegates: delegates.map((delegate) => ({
			id: delegate.id,
			name: delegate.name,
			job: delegate.job,
			grudgeTicks: Math.max(0, delegate.grudgeUntil - state.tick),
		})),
		decrees: Object.entries(decrees)
			.sort(([a], [b]) => compareKeys(a, b))
			.map(([, decree]) => structuredClone(decree)),
		desk: deskView(state, tuning),
		governors: [],
		crown: null,
		promotion: {
			target: tuning.village.promotionPopulation,
			promotedAt: state.career.promotedAt,
			promotedAtSeconds: (state.career.promotedAt * tuning.stepMs) / 1000,
		},
		lockedPanels: [...LOCKED_PANELS],
	};
}

function deskView(state: GameState, tuning: Tuning): DeskEntryView[] {
	const { delegates, desk } = state.posting;
	const nameOf = (id: number) => {
		const found = delegates.find((delegate) => delegate.id === id);
		if (found === undefined)
			throw new Error(`dispute party ${id} is not in the roster`);
		return found.name;
	};
	return desk.disputes.map((dispute) => {
		const template = templateOf(dispute, tuning);
		const first = nameOf(dispute.parties[0]);
		const second = nameOf(dispute.parties[1]);
		return {
			id: dispute.id,
			label: fillNames(template.text, first, second),
			parties: [first, second],
			options: template.options.map((option) => ({
				id: option.id,
				label: fillNames(option.label, first, second),
				affordable: shortfall(state, option) === null,
				expiry: option.id === template.expiry,
				resources: sortedResources(option.resources ?? {}),
				grudge: option.grudge ?? "none",
			})),
		};
	});
}

function sortedResources(resources: Record<string, number>) {
	const sorted: Record<string, number> = {};
	for (const key of sortedKeys(resources)) sorted[key] = resources[key] ?? 0;
	return sorted;
}
