import type { Game } from "./game";
import { RESOURCES, type Resource } from "./realm";

export type FlowProjection = {
  rates: Record<Resource, number>;
  growthPerTick: number;
};

export class ProjectionManager {
  constructor(private game: Game) {}

  // Runs the very phases the next step runs, on a copy, so the ledger rate cannot drift from the
  // real change. Commands and the dispute desk are left out on purpose: arrivals, expiries and
  // settlements are one-off events, not flows, and would make the rate jump.
  flows(): FlowProjection {
    const next = this.game.clone();
    next.state.tick += 1;
    next.steps.runFlows({
      tick: next.state.tick,
      maxValue: this.game.tuning.maxResourceValue,
      absorbed: null,
    });

    const rates = {} as Record<Resource, number>;
    for (const resource of RESOURCES) {
      rates[resource] =
        (next.state.posting.resources[resource] ?? 0) -
        (this.game.state.posting.resources[resource] ?? 0);
    }
    // A birth subtracts grainPerPeasant from the stored growth, so add it back per newborn to
    // report the grain actually fed rather than a negative change.
    const known = new Set(
      this.game.state.posting.delegates.map((delegate) => delegate.id),
    );
    const births = next.state.posting.delegates.filter(
      (delegate) => !known.has(delegate.id),
    ).length;
    const growthPerTick =
      next.state.posting.economy.growth -
      this.game.state.posting.economy.growth +
      this.game.tuning.economy.grainPerPeasant * births;
    return { rates, growthPerTick };
  }

  projectedRates(): Record<Resource, number> {
    return this.flows().rates;
  }
}
