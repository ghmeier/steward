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
	desk: DeskEntryView[];
	governors: GovernorView[];
	crown: CrownDemandView | null;
};

// The view is plain truth only in phase 2. Illusion, governor exaggeration and
// unlock filtering are applied here in later phases, so the UI must never read
// GameState directly.
export function computeView(state: GameState, tuning: Tuning): GameView {
	const ledger: LedgerLine[] = Object.entries(state.posting.resources)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([resource, amount]) => ({
			resource,
			amount,
			ratePerSecond:
				resource === tuning.toy.resource
					? (state.posting.toy.growthPerTick * 1000) / tuning.stepMs
					: 0,
		}));
	return {
		tick: state.tick,
		elapsedSeconds: (state.tick * tuning.stepMs) / 1000,
		ledger,
		desk: [],
		governors: [],
		crown: null,
	};
}
