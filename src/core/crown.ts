import { z } from "zod";
import type { CommandResult } from "./commands";
import { copy } from "./copy";
import { addIssue } from "./errors";
import type { Game } from "./game";
import { type AddContext, add } from "./math";
import { RESOURCES, type Resource } from "./realm";
import { drawDelay, intBelow, type RngState } from "./rng";
import {
  count,
  nonNegative,
  positive,
  positiveInteger,
  textWithPlaceholders,
} from "./schema";
import type { ResourceId } from "./state";
import { CONJURING } from "./unlocks";

export type Demand = {
  id: number;
  resource: ResourceId;
  amount: number;
  delivered: number;
  issuedAt: number;
  dueAt: number;
};

export type CrownState = {
  demand: Demand;
  nextDemandTick: number;
  met: number;
  missed: number;
  /** Added to the next demand, then cleared; it is what the crown claims for the last shortfall. */
  surcharge: number;
  /** The resource of the most recent demand, so the next one can differ; empty before the first. */
  lastResource: ResourceId;
  /** How the crown regards the steward, from -limit to limit; it never decays. */
  favor: number;
};

const demand = z.strictObject({
  id: count,
  resource: z.string(),
  amount: z.number().min(0),
  delivered: z.number().min(0),
  issuedAt: count,
  dueAt: count,
});

export const crownStateSchema: z.ZodType<CrownState> = z.strictObject({
  demand,
  nextDemandTick: count,
  met: count,
  missed: count,
  surcharge: z.number().min(0),
  lastResource: z.string(),
  favor: z.number().min(-100).max(100),
});

export type FavorBand = "cold" | "neutral" | "warm";

/**
 * Stands for "no demand is open". State validation and `canonicalStringify` reject null, so the
 * absence of a demand is stored as an id no issued demand can have.
 */
export const NO_DEMAND: Readonly<Demand> = {
  id: 0,
  resource: "",
  amount: 0,
  delivered: 0,
  issuedAt: 0,
  dueAt: 0,
};

/** Stands for "no demand scheduled", which holds until promotion; ticks start at 1, so 0 is never due. */
export const NO_DEMAND_TICK = 0;

export function emptyCrownState(): CrownState {
  return {
    demand: { ...NO_DEMAND },
    nextDemandTick: NO_DEMAND_TICK,
    met: 0,
    missed: 0,
    surcharge: 0,
    lastResource: "",
    favor: 0,
  };
}

const amountText = textWithPlaceholders(["amount"]);

const crownLines = z.strictObject({
  herald: amountText,
  met: amountText,
  missed: amountText,
});

const favor = z
  .strictObject({
    limit: positive,
    coldBelow: z.number(),
    warmAbove: z.number(),
    met: nonNegative,
    early: nonNegative,
    missed: z.number().max(0),
    backed: nonNegative,
    deepened: z.number().max(0),
    failed: z.number().max(0),
    cold: z.strictObject({
      debtShareFactor: positive,
      warningFactor: positive,
      stepFactor: positive,
    }),
    warm: z.strictObject({
      ceilingFactor: positive,
      rewardFactor: positive,
    }),
  })
  .superRefine((value, ctx) => {
    if (value.coldBelow >= value.warmAbove) {
      addIssue(ctx, "must be below warmAbove", ["coldBelow"]);
    }
  });

export const crownTuningSchema = z.strictObject({
  firstDemandTicks: positiveInteger,
  deadlineTicks: positiveInteger,
  gap: z
    .strictObject({ minTicks: positiveInteger, maxTicks: positiveInteger })
    .superRefine((gap, ctx) => {
      if (gap.minTicks > gap.maxTicks) {
        addIssue(ctx, "must not exceed maxTicks", ["minTicks"]);
      }
    }),
  baseAmounts: z.record(z.enum(RESOURCES), positive),
  step: nonNegative,
  grainReserveSeasons: nonNegative,
  surcharge: nonNegative,
  reward: nonNegative,
  favor,
  lines: z.record(z.enum(RESOURCES), crownLines),
});

export type CrownTuning = z.infer<typeof crownTuningSchema>;

export class CrownManager {
  constructor(private game: Game) {}

  private get crown() {
    return this.game.state.posting.crown;
  }

  private get tuning() {
    return this.game.tuning.crown;
  }

  private get tick() {
    return this.game.state.tick;
  }

  private get stream(): RngState {
    const stream = this.game.state.posting.rng.crown;
    if (stream === undefined) throw new Error("the crown stream is missing");
    return stream;
  }

  get band(): FavorBand {
    const { coldBelow, warmAbove } = this.tuning.favor;
    if (this.crown.favor < coldBelow) return "cold";
    return this.crown.favor > warmAbove ? "warm" : "neutral";
  }

  get stepFactor(): number {
    return this.band === "cold" ? this.tuning.favor.cold.stepFactor : 1;
  }

  get debtShareFactor(): number {
    return this.band === "cold" ? this.tuning.favor.cold.debtShareFactor : 1;
  }

  get warningFactor(): number {
    return this.band === "cold" ? this.tuning.favor.cold.warningFactor : 1;
  }

  get ceilingFactor(): number {
    return this.band === "warm" ? this.tuning.favor.warm.ceilingFactor : 1;
  }

  get rewardFactor(): number {
    return this.band === "warm" ? this.tuning.favor.warm.rewardFactor : 1;
  }

  private shiftFavor(delta: number): void {
    const { limit } = this.tuning.favor;
    this.crown.favor = Math.min(
      limit,
      Math.max(-limit, this.crown.favor + delta),
    );
  }

  get isOpen(): boolean {
    return this.crown.demand.id !== NO_DEMAND.id;
  }

  /** What is still owed on the open demand; zero when none is open. */
  get owed(): number {
    const { amount, delivered } = this.crown.demand;
    return amount - delivered;
  }

  /** Ticks until the open demand is collected; zero when none is open. */
  get ticksLeft(): number {
    return this.isOpen ? Math.max(0, this.crown.demand.dueAt - this.tick) : 0;
  }

  owedIn(resource: ResourceId): number {
    return this.crown.demand.resource === resource ? this.owed : 0;
  }

  scheduleFirstDemand(): void {
    this.crown.nextDemandTick = this.tick + this.tuning.firstDemandTicks;
  }

  private get resources() {
    return this.game.state.posting.resources;
  }

  private get held(): number {
    return this.game.illusion.apparent(this.crown.demand.resource);
  }

  /**
   * What the crown may take of the open demand's resource. Grain keeps a reserve of seasons of
   * upkeep so that a demand larger than the stores cannot empty the granary and starve the village.
   * Only real grain is protected; conjured grain is not food, so it can always be handed over.
   */
  private get available(): number {
    if (this.crown.demand.resource !== "grain") return this.held;
    const reserve =
      this.tuning.grainReserveSeasons *
      this.game.economy.grainUpkeepPerSeason();
    const real = this.resources.grain ?? 0;
    return this.held - Math.min(real, reserve);
  }

  private drawResource(): Resource {
    const choices = RESOURCES.filter(
      (resource) => resource !== this.crown.lastResource,
    );
    return choices[intBelow(this.stream, choices.length)] ?? RESOURCES[0];
  }

  private issue(): void {
    const { crown, tuning } = this;
    const resource = this.drawResource();
    const base = tuning.baseAmounts[resource];
    const step = tuning.step * this.stepFactor;
    crown.demand = {
      id: crown.met + crown.missed + 1,
      resource,
      amount: Math.round(base * (1 + step * crown.met) + crown.surcharge),
      delivered: 0,
      issuedAt: this.tick,
      dueAt: this.tick + tuning.deadlineTicks,
    };
    crown.surcharge = 0;
    crown.lastResource = resource;
    const { unlocks } = this.game.state.career;
    if (!this.game.unlocks.enabled(CONJURING)) unlocks[CONJURING] = this.tick;
  }

  private close(): void {
    this.crown.demand = { ...NO_DEMAND };
    this.crown.nextDemandTick =
      this.tick + drawDelay(this.stream, this.tuning.gap);
  }

  private meet(early: boolean): void {
    const { favor } = this.tuning;
    this.crown.met += 1;
    this.shiftFavor(favor.met + (early ? favor.early : 0));
    this.close();
  }

  /** Removes as much of what is owed as the store appears to hold beyond any reserve and returns the amount removed. */
  private take(context: AddContext): number {
    const taken = Math.min(this.owed, this.available);
    this.game.illusion.spend(this.crown.demand.resource, taken, context);
    return taken;
  }

  /**
   * The surcharge accumulates instead of being set because an audit can record a miss while the
   * surcharge from an earlier miss has not yet been charged to a demand.
   */
  private countMiss(uncovered: number): void {
    this.crown.surcharge += this.tuning.surcharge * uncovered;
    this.crown.missed += 1;
  }

  /** The crown's reaction to an audit that was backed or deepened; a failed one goes through `recordFailedAudit`. */
  recordAudit(outcome: "backed" | "deepened"): void {
    this.shiftFavor(this.tuning.favor[outcome]);
  }

  /**
   * A failed audit costs its own favor figure and not the missed-demand figure on top, even though
   * an uncovered remainder still counts as a missed demand.
   */
  recordFailedAudit(uncovered: number): void {
    if (uncovered > 0) this.countMiss(uncovered);
    this.shiftFavor(this.tuning.favor.failed);
  }

  /** A demand is missed only when the store cannot cover it at the deadline. */
  private collect(context: AddContext): void {
    const uncovered = this.owed - this.take(context);
    if (uncovered > 0) {
      this.countMiss(uncovered);
      this.shiftFavor(this.tuning.favor.missed);
      this.close();
    } else {
      this.meet(false);
    }
  }

  /** Paying in full before the deadline earns a reward that collection at the deadline does not. */
  deliver(context: AddContext): CommandResult {
    if (!this.isOpen) return { ok: false, reason: copy.crown.noDemand };
    if (this.available <= 0) {
      return {
        ok: false,
        reason: copy.crown.villageHoldsNone({
          resource: this.crown.demand.resource,
        }),
      };
    }
    this.credit(this.take(context), context);
    return { ok: true };
  }

  /** Counts a payment, real or forged, toward the open demand; paying it off in full earns the reward. */
  credit(paid: number, context: AddContext): void {
    const { demand } = this.crown;
    const completes = paid >= this.owed;
    demand.delivered += paid;
    if (completes) {
      const payout = this.tuning.reward * this.rewardFactor * demand.amount;
      add(this.resources, "coin", payout, context);
      this.meet(true);
    }
  }

  /** A demand is issued or resolved in a step, never both, so a deadline is always at least a step away. */
  run(context: AddContext): void {
    if (this.isOpen) {
      if (this.tick >= this.crown.demand.dueAt) this.collect(context);
    } else if (
      this.crown.nextDemandTick !== NO_DEMAND_TICK &&
      this.tick >= this.crown.nextDemandTick
    ) {
      this.issue();
    }
  }
}
