import { z } from "zod";
import type { Game } from "./game";
import { add, log2Fixed } from "./math";
import { EXTRACTION } from "./prestige";
import type { FlowProjection } from "./projection";
import {
  CAPPED_RESOURCES,
  type CappedResource,
  perResource,
  RESOURCES,
  type Resource,
  SEASONS,
} from "./realm";
import { positiveInteger } from "./schema";

export const offlineTuningSchema = z.strictObject({
  /** Time away up to this many ticks counts in full. */
  graceTicks: positiveInteger,
  /** How slowly time past the grace window adds up: it doubles the credit each time the excess doubles its worth. */
  curveTicks: positiveInteger,
});

export type OfflineSummary = {
  realTicks: number;
  compressedTicks: number;
  /** What each store gained, as the change it actually took after caps and the floor at zero. */
  gains: Record<Resource, number>;
  /** Coin value of the interest added to the debt. */
  debtAdded: number;
  /** Coin value of the conjured stock that faded away. */
  conjuredFaded: number;
  fullStores: CappedResource[];
};

/** Credits the time a player spent away at a reduced rate, without running any of the game's events. */
export class OfflineManager {
  constructor(private game: Game) {}

  private get tuning() {
    return this.game.tuning.offline;
  }

  private get resources() {
    return this.game.state.posting.resources;
  }

  /** A span that is not positive, including the NaN an unreadable save timestamp gives, is no time away. */
  ticksAway(awayMs: number): number {
    return awayMs > 0 ? Math.floor(awayMs / this.game.tuning.stepMs) : 0;
  }

  /** Time within the grace window counts in full; past it, each doubling of the excess adds one more curve's worth. */
  compress(realTicks: number): number {
    const { graceTicks, curveTicks } = this.tuning;
    if (realTicks <= graceTicks) return realTicks;
    const excess = (realTicks - graceTicks) / curveTicks;
    return Math.floor(graceTicks + curveTicks * log2Fixed(1 + excess));
  }

  /**
   * Applies the rates in force once over the compressed time. The tick does not move, so every
   * deadline, the season and the desk stay as they were when the player left.
   */
  catchUp(realTicks: number): OfflineSummary {
    const compressedTicks = this.compress(realTicks);
    const before = { ...this.resources };
    const debtBefore = this.game.illusion.debtValue;
    const conjuredBefore = this.game.illusion.conjuredValue;
    // Averaging the flows clones the game once per season, which is wasted work when no time is credited.
    if (compressedTicks > 0) {
      this.applyFlows(compressedTicks);
      this.game.illusion.elapse(compressedTicks);
    }

    return {
      realTicks,
      compressedTicks,
      gains: perResource(
        (resource) => (this.resources[resource] ?? 0) - (before[resource] ?? 0),
      ),
      debtAdded: this.game.illusion.debtValue - debtBefore,
      conjuredFaded: conjuredBefore - this.game.illusion.conjuredValue,
      fullStores: CAPPED_RESOURCES.filter(
        (resource) =>
          (this.resources[resource] ?? 0) >= this.game.economy.capOf(resource),
      ),
    };
  }

  private applyFlows(ticks: number): void {
    const { rates, growthPerTick, oreDugPerTick } = this.averageFlows();
    if (this.game.prestige.hasDoctrine(EXTRACTION)) {
      // The one-tick projection sees the prospecting payout only on a season-end tick, and the net
      // ore change is zero once the store is full, so the share of the ore dug is added here instead.
      rates.coin += oreDugPerTick * this.game.tuning.doctrines.prospectingShare;
    }

    const context = this.game.economy.addContext(null);
    for (const resource of RESOURCES) {
      const floorAtZero = -(this.resources[resource] ?? 0);
      add(
        this.resources,
        resource,
        Math.max(rates[resource] * ticks, floorAtZero),
        context,
      );
    }
    this.growWithoutBirth(growthPerTick * ticks);
  }

  /** Grain fed to the village is kept as growth, but stops just short of the grain a birth costs. */
  private growWithoutBirth(fed: number): void {
    const { economy } = this.game.state.posting;
    const ceiling =
      this.game.tuning.economy.grainPerPeasant * (1 - Number.EPSILON);
    economy.growth = Math.max(
      economy.growth,
      Math.min(economy.growth + fed, ceiling),
    );
  }

  /**
   * The per-tick rates averaged over one tick early in each season, so a save left in winter still
   * gains the grain the other seasons bring. Each probe starts from the next such tick, which is
   * never earlier than the present, so a grudge can only have lapsed.
   */
  private averageFlows(): Pick<
    FlowProjection,
    "rates" | "growthPerTick" | "oreDugPerTick"
  > {
    const probes = SEASONS.map((_, season) =>
      this.game.projection.flows(this.tickInSeason(season)),
    );
    const mean = (of: (flows: FlowProjection) => number) =>
      probes.reduce((sum, flows) => sum + of(flows), 0) / probes.length;
    return {
      rates: perResource((resource) => mean((flows) => flows.rates[resource])),
      growthPerTick: mean((flows) => flows.growthPerTick),
      oreDugPerTick: mean((flows) => flows.oreDugPerTick),
    };
  }

  /** A tick just after the season at this index begins, in the first year where it is not already past. */
  private tickInSeason(index: number): number {
    const { ticksPerSeason } = this.game.tuning.economy;
    const year = ticksPerSeason * SEASONS.length;
    const { tick } = this.game.state;
    const candidate =
      Math.floor(tick / year) * year + index * ticksPerSeason + 1;
    return candidate < tick ? candidate + year : candidate;
  }
}
