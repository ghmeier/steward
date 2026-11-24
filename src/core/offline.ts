import { z } from "zod";
import type { Game } from "./game";
import { add, log2Fixed } from "./math";
import { EXTRACTION } from "./prestige";
import {
  CAPPED_RESOURCES,
  type CappedResource,
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

  private get ticksPerSeason() {
    return this.game.tuning.economy.ticksPerSeason;
  }

  private get resources() {
    return this.game.state.posting.resources;
  }

  /** Time within the grace window counts in full; past it each doubling of the excess adds one more curve's worth. */
  compress(realTicks: number): number {
    const { graceTicks, curveTicks } = this.tuning;
    if (realTicks <= graceTicks) return Math.max(0, realTicks);
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
    if (compressedTicks > 0) {
      this.applyFlows(compressedTicks);
      this.game.illusion.elapse(compressedTicks);
    }

    const gains = {} as Record<Resource, number>;
    for (const resource of RESOURCES) {
      gains[resource] =
        (this.resources[resource] ?? 0) - (before[resource] ?? 0);
    }
    return {
      realTicks,
      compressedTicks,
      gains,
      debtAdded: this.game.illusion.debtValue - debtBefore,
      conjuredFaded: conjuredBefore - this.game.illusion.conjuredValue,
      fullStores: CAPPED_RESOURCES.filter(
        (resource) =>
          (this.resources[resource] ?? 0) >= this.game.economy.capOf(resource),
      ),
    };
  }

  private applyFlows(ticks: number): void {
    const { rates, growthPerTick } = this.averageFlows();
    if (this.game.prestige.hasDoctrine(EXTRACTION)) {
      // The one-tick projection sees the prospecting payout only on a season-end tick, so the share
      // of the mined ore is added here instead.
      rates.coin +=
        Math.max(0, rates.ore) * this.game.tuning.doctrines.prospectingShare;
    }

    const context = {
      tick: this.game.state.tick,
      maxValue: this.game.tuning.maxResourceValue,
      capOf: (resource: string) => this.game.economy.capOf(resource),
      absorbed: null,
    };
    for (const resource of RESOURCES) {
      const current = this.resources[resource] ?? 0;
      add(
        this.resources,
        resource,
        Math.max(rates[resource] * ticks, -current),
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
   * The per-tick rates averaged over one mid-season tick of each season, so a save left in winter
   * still gains the grain the other seasons bring. Each probe is a copy whose clock is set to the
   * next such tick, which is never earlier than the present, so a grudge can only have lapsed.
   */
  private averageFlows(): {
    rates: Record<Resource, number>;
    growthPerTick: number;
  } {
    const rates = Object.fromEntries(
      RESOURCES.map((resource) => [resource, 0]),
    ) as Record<Resource, number>;
    let growthPerTick = 0;
    for (const season of SEASONS.keys()) {
      const probe = this.game.clone();
      probe.state.tick = this.tickInSeason(season);
      const flows = probe.projection.flows();
      for (const resource of RESOURCES) {
        rates[resource] += flows.rates[resource] / SEASONS.length;
      }
      growthPerTick += flows.growthPerTick / SEASONS.length;
    }
    return { rates, growthPerTick };
  }

  /** The tick before the second tick of the season at this index, in the first year that is not already past. */
  private tickInSeason(index: number): number {
    const year = this.ticksPerSeason * SEASONS.length;
    const { tick } = this.game.state;
    const thisYear = Math.floor(tick / year) * year;
    const candidate = thisYear + index * this.ticksPerSeason + 1;
    return candidate < tick ? candidate + year : candidate;
  }
}
