import type { CommandResult } from "./commands";
import type { Game } from "./game";
import { type AddContext, add } from "./math";
import { RESOURCES, type Resource } from "./realm";
import { drawDelay, intBelow, type RngState } from "./rng";
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
};

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
  };
}

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

  get isOpen(): boolean {
    return this.crown.demand.id !== NO_DEMAND.id;
  }

  /** What is still owed on the open demand; zero when none is open. */
  get owed(): number {
    const { amount, delivered } = this.crown.demand;
    return amount - delivered;
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
    crown.demand = {
      id: crown.met + crown.missed + 1,
      resource,
      amount: Math.round(
        base * (1 + tuning.step * crown.met) + crown.surcharge,
      ),
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

  private meet(): void {
    this.crown.met += 1;
    this.close();
  }

  /** Removes as much of what is owed as the store appears to hold and returns the amount removed. */
  private take(context: AddContext): number {
    const taken = Math.min(this.owed, this.held);
    this.game.illusion.spend(this.crown.demand.resource, taken, context);
    return taken;
  }

  /**
   * Counts a miss and claims a share of what was left uncovered on the next demand. The surcharge
   * accumulates because an audit can record a miss while another shortfall is still waiting.
   */
  recordMiss(uncovered: number): void {
    this.crown.surcharge += this.tuning.surcharge * uncovered;
    this.crown.missed += 1;
  }

  /** A demand is missed only when the store cannot cover it at the deadline. */
  private collect(context: AddContext): void {
    const uncovered = this.owed - this.take(context);
    if (uncovered > 0) {
      this.recordMiss(uncovered);
      this.close();
    } else {
      this.meet();
    }
  }

  /** Paying in full before the deadline earns a reward that collection at the deadline does not. */
  deliver(context: AddContext): CommandResult {
    if (!this.isOpen)
      return { ok: false, reason: "the crown has made no demand" };
    if (this.held <= 0) {
      return {
        ok: false,
        reason: `the village holds no ${this.crown.demand.resource}`,
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
      add(this.resources, "coin", this.tuning.reward * demand.amount, context);
      this.meet();
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
