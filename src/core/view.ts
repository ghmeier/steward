import { idlePeasants, seasonAt, steadyRates } from "./economy";
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
	const economy = state.posting.economy;
	return {
		tick: state.tick,
		elapsedSeconds: (state.tick * tuning.stepMs) / 1000,
		ledger,
		realm: {
			population: economy.population,
			idle: idlePeasants(economy),
			labor: { ...economy.labor },
			season: seasonAt(state.tick, tuning.economy.ticksPerSeason),
		},
		desk: [],
		governors: [],
		crown: null,
	};
}
