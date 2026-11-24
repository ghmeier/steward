import { z } from "zod";
import { copy } from "./copy";
import type { Game } from "./game";
import { NO_LABOR_POLICY } from "./labor";
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
  WORKING_JOBS,
} from "./realm";
import { positive, positiveInteger } from "./schema";
import { TRUE_REPORTS } from "./unlocks";

export const offlineTuningSchema = z.strictObject({
  /** Time away up to this many ticks counts in full. */
  graceTicks: positiveInteger,
  /** How slowly time past the grace window adds up: it doubles the credit each time the excess doubles its worth. */
  curveTicks: positiveInteger,
  /** A labor policy that puts at least this share of the workers on one job counts as lopsided. */
  lopsidedShare: z.number().gt(0).max(1),
  /** Each signal left on adds this much to the return report's scale for every compressed hour away. */
  returnScalePerHour: positive,
  /** The most the return report's scale can reach, however long the player is away. */
  returnScaleMax: positive,
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
    // Read before any store changes, because a decree's rules can depend on the stores.
    const scale = compressedTicks > 0 ? this.returnScale(compressedTicks) : 0;
    const before = { ...this.resources };
    const debtBefore = this.game.illusion.debtValue;
    const conjuredBefore = this.game.illusion.conjuredValue;
    // Averaging the flows clones the game once per season, which is wasted work when no time is credited.
    if (compressedTicks > 0) {
      this.applyFlows(compressedTicks);
      this.game.illusion.elapse(compressedTicks);
    }

    const summary: OfflineSummary = {
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
    if (compressedTicks > 0) this.placeReturnReport(summary, scale);
    return summary;
  }

  /** Food is on when a harvest decree chose to sell at exit; labor when the allocation in force sends most workers to one job. */
  private get signals(): number {
    return Number(this.sellingHarvest) + Number(this.lopsidedLabor);
  }

  private get sellingHarvest(): boolean {
    const { policies } = this.game.projection.flows();
    return Object.values(this.game.decrees.enacted).some(
      ({ id, petition }) => petition === "harvest" && policies[id] === "sell",
    );
  }

  private get lopsidedLabor(): boolean {
    const { policy } = this.game.labor;
    if (policy === NO_LABOR_POLICY) return false;
    const shares = this.game.economy.laborSharesFor(policy);
    return WORKING_JOBS.some((job) => shares[job] >= this.tuning.lopsidedShare);
  }

  private returnScale(compressedTicks: number): number {
    const { returnScalePerHour, returnScaleMax } = this.tuning;
    const hours = (compressedTicks * this.game.tuning.stepMs) / 3_600_000;
    return Math.min(returnScaleMax, this.signals * hours * returnScalePerHour);
  }

  /** A governor reports, inflating the gains by their report factor unless true reports are owned; with none serving, a clerk reports them accurately. */
  private placeReturnReport(summary: OfflineSummary, scale: number): void {
    const { governors, unlocks } = this.game;
    const governor = governors.leadingReporter;
    const factor =
      governor === undefined || unlocks.enabled(TRUE_REPORTS)
        ? 1
        : governors.reportFactorOf(governor);
    const gains: Partial<Record<Resource, number>> = {};
    for (const resource of RESOURCES) {
      if (summary.gains[resource] > 0) {
        gains[resource] = summary.gains[resource] * factor;
      }
    }
    this.game.desk.placeReturn({
      away: summary.realTicks,
      gains,
      reporter: governor?.name ?? copy.desk.clerk,
      scale,
    });
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
