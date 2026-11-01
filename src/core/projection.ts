import { RESOURCES, type Resource } from "./realm";
import type { GameStateManager } from "./state";

export type FlowProjection = {
  rates: Record<Resource, number>;
  growthPerTick: number;
};

export class ProjectionManager {
  constructor(private manager: GameStateManager) {}

  // Runs the very phases the next step runs, on a copy, so the ledger rate cannot drift from the
  // real change. Commands and the dispute desk are left out on purpose: arrivals, expiries and
  // settlements are one-off events, not flows, and would make the rate jump.
  flows(): FlowProjection {
    const next = this.manager.clone();
    next.state.tick += 1;
    next.sm.runFlows({
      tick: next.state.tick,
      maxValue: this.manager.tuning.maxResourceValue,
      absorbed: null,
    });

    const rates = {} as Record<Resource, number>;
    for (const resource of RESOURCES) {
      rates[resource] =
        (next.state.posting.resources[resource] ?? 0) -
        (this.manager.state.posting.resources[resource] ?? 0);
    }
    // A birth subtracts grainPerPeasant from the stored growth, so add it back per newborn to
    // report the grain actually fed rather than a negative change.
    const known = new Set(
      this.manager.state.posting.delegates.map((delegate) => delegate.id),
    );
    const births = next.state.posting.delegates.filter(
      (delegate) => !known.has(delegate.id),
    ).length;
    const growthPerTick =
      next.state.posting.economy.growth -
      this.manager.state.posting.economy.growth +
      this.manager.tuning.economy.grainPerPeasant * births;
    return { rates, growthPerTick };
  }

  projectedRates(): Record<Resource, number> {
    return this.flows().rates;
  }
}
