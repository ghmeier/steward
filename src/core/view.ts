import { compareKeys } from "./data";
import type { Decree } from "./decree";
import { idleCount, laborCounts } from "./delegates";
import { seasonAt, steadyRates } from "./economy";
import { type Job, RESOURCES, type Season } from "./realm";
import type { GameState, ResourceId } from "./state";
import type { Tuning } from "./tuning";

export type LedgerLine = {
	resource: ResourceId;
	amount: number;
	ratePerSecond: number;
};
export type DeskEntryView = { id: string; label: string };
export type GovernorView = { id: string; name: string };
export type DelegateView = {
	id: number;
	name: string;
	job: Job | "idle";
	grudgeTicks: number;
};
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
};

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
		desk: [],
		governors: [],
		crown: null,
	};
}
