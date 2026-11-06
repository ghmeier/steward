import type { CommandResult } from "./commands";
import type { Game } from "./game";
import { type AddContext, add } from "./math";
import { RESOURCES, type Resource } from "./realm";
import { intBelow, type RngState } from "./rng";
import type { ResourceId } from "./state";

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

  /** What is still owed in `resource`, which is zero unless the open demand is for it. */
  owedIn(resource: ResourceId): number {
    return this.crown.demand.resource === resource ? this.owed : 0;
  }

  /** The crown's first demand comes a fixed time after the promotion that starts them. */
  scheduleFirstDemand(): void {
    this.crown.nextDemandTick = this.tick + this.tuning.firstDemandTicks;
  }

  private drawGap(): number {
    const { minTicks, maxTicks } = this.tuning.gap;
    return minTicks + intBelow(this.stream, maxTicks - minTicks + 1);
  }

  private drawResource(): Resource {
    const choices = RESOURCES.filter(
      (resource) => resource !== this.crown.lastResource,
    );
    const choice = choices[intBelow(this.stream, choices.length)];
    if (choice === undefined) throw new Error("resource draw out of range");
    return choice;
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
  }

  private close(): void {
    this.crown.demand = { ...NO_DEMAND };
    this.crown.nextDemandTick = this.tick + this.drawGap();
  }

  private meet(): void {
    this.crown.met += 1;
    this.close();
  }

  private seize(context: AddContext): void {
    const { crown, tuning } = this;
    const { resource } = crown.demand;
    const held = this.game.state.posting.resources[resource] ?? 0;
    const taken = Math.min(this.owed, held);
    this.game.desk.applyResources({ [resource]: -taken }, context, true);
    crown.surcharge = tuning.surcharge * (this.owed - taken);
    crown.missed += 1;
    this.close();
  }

  /** Moves stock toward the open demand; paying it in full before the deadline earns a reward. */
  deliver(context: AddContext): CommandResult {
    if (!this.isOpen)
      return { ok: false, reason: "the crown has made no demand" };
    const { demand } = this.crown;
    const held = this.game.state.posting.resources[demand.resource] ?? 0;
    if (held <= 0) {
      return { ok: false, reason: `the village holds no ${demand.resource}` };
    }
    const paid = Math.min(this.owed, held);
    const complete = paid >= this.owed;
    add(this.game.state.posting.resources, demand.resource, -paid, context);
    demand.delivered = complete ? demand.amount : demand.delivered + paid;
    if (complete) {
      add(
        this.game.state.posting.resources,
        "coin",
        this.tuning.reward * demand.amount,
        context,
      );
      this.meet();
    }
    return { ok: true };
  }

  /** A demand is issued or resolved in a step, never both, so a deadline is always at least a step away. */
  run(context: AddContext): void {
    if (this.isOpen) {
      if (this.tick >= this.crown.demand.dueAt) this.seize(context);
    } else if (
      this.crown.nextDemandTick !== NO_DEMAND_TICK &&
      this.tick >= this.crown.nextDemandTick
    ) {
      this.issue();
    }
  }
}
