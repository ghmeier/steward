import type { CommandResult } from "./commands";
import type { Game } from "./game";
import { type AddContext, add } from "./math";
import { RESOURCES, type Resource } from "./realm";
import type { ResourceId } from "./state";
import { CONJURING } from "./unlocks";

/** Only these can be conjured; the stores of ore and wood are never faked. */
export const CONJURABLE = ["coin", "grain"] as const;

export type Books = "clean" | "thin" | "strained" | "rotten";

export type IllusionState = {
  /** Illusory units sitting in the stores, keyed by conjurable resource. */
  conjured: Record<ResourceId, number>;
  /** Illusory units that were passed off as real, keyed by resource. */
  debt: Record<ResourceId, number>;
  /** The tick the debt last rose from zero; see `NO_DEBT_TICK`. */
  debtSince: number;
  /** The tick announced auditors arrive; see `NO_AUDIT_TICK`. */
  auditAt: number;
  audits: { backed: number; deepened: number; failed: number };
};

/**
 * Stands for "no debt is owed". State validation and `canonicalStringify` reject null, so the
 * absence of debt is stored as a tick no debt can have rise at; ticks start at 1.
 */
export const NO_DEBT_TICK = 0;

/** Stands for "no auditors are on the road", for the same reason as `NO_DEBT_TICK`. */
export const NO_AUDIT_TICK = 0;

export function emptyIllusionState(): IllusionState {
  return {
    conjured: { coin: 0, grain: 0 },
    debt: { coin: 0, grain: 0, ore: 0, wood: 0 },
    debtSince: NO_DEBT_TICK,
    auditAt: NO_AUDIT_TICK,
    audits: { backed: 0, deepened: 0, failed: 0 },
  };
}

export class IllusionManager {
  constructor(private game: Game) {}

  private get illusion() {
    return this.game.state.posting.illusion;
  }

  private get tuning() {
    return this.game.tuning.illusion;
  }

  private get resources() {
    return this.game.state.posting.resources;
  }

  private get isUnlocked(): boolean {
    return this.game.unlocks.enabled(CONJURING);
  }

  conjuredOf(resource: ResourceId): number {
    return this.illusion.conjured[resource] ?? 0;
  }

  private debtOf(resource: ResourceId): number {
    return this.illusion.debt[resource] ?? 0;
  }

  /** What the village appears to hold: the real stock plus the conjured units. */
  apparent(resource: ResourceId): number {
    return (this.resources[resource] ?? 0) + this.conjuredOf(resource);
  }

  private get hasDebt(): boolean {
    return this.illusion.debtSince !== NO_DEBT_TICK;
  }

  private valueOf(amounts: Record<ResourceId, number>): number {
    let total = 0;
    for (const resource of RESOURCES) {
      total += (amounts[resource] ?? 0) * this.game.economy.priceOf(resource);
    }
    return total;
  }

  /** Coin value of the conjured stock. */
  get conjuredValue(): number {
    return this.valueOf(this.illusion.conjured);
  }

  /** Coin value of all the debt. */
  get debtValue(): number {
    return this.valueOf(this.illusion.debt);
  }

  private get exposure(): number {
    return this.conjuredValue + this.debtValue;
  }

  get ceiling(): number {
    return (
      this.tuning.ceilingPerPeasant * this.game.state.posting.delegates.length
    );
  }

  /** Interest can carry exposure past the ceiling, so the room is floored at zero. */
  get room(): number {
    return Math.max(0, this.ceiling - this.exposure);
  }

  get books(): Books {
    const exposure = this.exposure;
    if (exposure <= 0) return "clean";
    const share = exposure / this.ceiling;
    if (share >= this.tuning.books.rotten) return "rotten";
    if (share >= this.tuning.books.strained) return "strained";
    return "thin";
  }

  private owe(resource: ResourceId, amount: number): void {
    if (!this.hasDebt) this.illusion.debtSince = this.game.state.tick;
    this.illusion.debt[resource] = this.debtOf(resource) + amount;
  }

  /**
   * Pays an outsider. Conjured units go first because they fade, and whatever they cover becomes
   * debt; the rest comes out of the real stock.
   */
  spend(resource: ResourceId, amount: number, context: AddContext): void {
    const conjured = Math.min(amount, this.conjuredOf(resource));
    if (conjured > 0) {
      this.illusion.conjured[resource] = this.conjuredOf(resource) - conjured;
      this.owe(resource, conjured);
    }
    add(this.resources, resource, conjured - amount, context);
  }

  conjure(resource: Resource, amount: number): CommandResult {
    if (!this.isUnlocked) {
      return { ok: false, reason: "you cannot conjure yet" };
    }
    if (!(CONJURABLE as readonly string[]).includes(resource)) {
      return { ok: false, reason: `${resource} cannot be conjured` };
    }
    if (amount <= 0) {
      return { ok: false, reason: "the amount to conjure must be positive" };
    }
    const cost = amount * this.game.economy.priceOf(resource);
    if (cost > this.room) {
      return {
        ok: false,
        reason: `the ceiling leaves room for only ${Math.floor(this.room)} coin of illusion`,
      };
    }
    this.illusion.conjured[resource] = this.conjuredOf(resource) + amount;
    return { ok: true };
  }

  /** Marks as much of what the crown still wants as the room allows as delivered on paper. */
  forge(context: AddContext): CommandResult {
    if (!this.isUnlocked) {
      return { ok: false, reason: "you cannot forge reports yet" };
    }
    const { crown } = this.game;
    if (!crown.isOpen) {
      return { ok: false, reason: "the crown has made no demand" };
    }
    if (this.room <= 0) {
      return { ok: false, reason: "the ceiling leaves no room for a report" };
    }
    const resource = this.game.state.posting.crown.demand.resource;
    const price = this.game.economy.priceOf(resource as Resource);
    const forged = Math.min(crown.owed, this.room / price);
    this.owe(resource, forged);
    crown.credit(forged, context);
    return { ok: true };
  }

  /** Repays debt from real stock alone, as far as the stock reaches. */
  back(resource: Resource, context: AddContext): CommandResult {
    if (!this.isUnlocked) {
      return { ok: false, reason: "you have no illusions to back yet" };
    }
    const owed = this.debtOf(resource);
    if (owed <= 0) {
      return { ok: false, reason: `there is no ${resource} debt to back` };
    }
    const held = this.resources[resource] ?? 0;
    if (held <= 0) {
      return {
        ok: false,
        reason: `the village holds no ${resource} to back it`,
      };
    }
    const repaid = Math.min(owed, held);
    add(this.resources, resource, -repaid, context);
    this.illusion.debt[resource] = owed - repaid;
    if (!RESOURCES.some((id) => this.debtOf(id) > 0)) {
      this.illusion.debtSince = NO_DEBT_TICK;
    }
    return { ok: true };
  }

  /** Ticks until announced auditors reach the desk; null when none are on the road. */
  get auditInTicks(): number | null {
    const { auditAt } = this.illusion;
    return auditAt === NO_AUDIT_TICK ? null : auditAt - this.game.state.tick;
  }

  /** The cost of an audit option as negative deltas, worked out from the debt as it stands. */
  auditCost(optionId: string): Record<string, number> {
    if (optionId === "deepen") {
      return { coin: -this.tuning.audit.deepenCost * this.debtValue };
    }
    const cost: Record<string, number> = {};
    for (const resource of RESOURCES) {
      if (this.debtOf(resource) > 0) cost[resource] = -this.debtOf(resource);
    }
    return cost;
  }

  /** Auditors accept only real stock, so apparent stock does not count here. */
  auditShortfall(optionId: string): string | null {
    for (const [resource, delta] of Object.entries(this.auditCost(optionId))) {
      const held = this.resources[resource] ?? 0;
      if (held + delta < 0) {
        return `not enough real ${resource} (need ${Math.ceil(-delta)}, have ${Math.floor(held)})`;
      }
    }
    return null;
  }

  private clearDebt(): void {
    for (const resource of RESOURCES) this.illusion.debt[resource] = 0;
    this.illusion.debtSince = NO_DEBT_TICK;
  }

  /** Pays an audit option's cost from real stock and applies its effect; the caller checked it is affordable. */
  settleAudit(optionId: string, context: AddContext): void {
    for (const [resource, delta] of Object.entries(this.auditCost(optionId))) {
      add(this.resources, resource, delta, context);
    }
    if (optionId === "deepen") {
      for (const resource of RESOURCES) {
        this.illusion.debt[resource] =
          this.debtOf(resource) * this.tuning.audit.deepenGrowth;
      }
      this.illusion.debtSince = this.game.state.tick;
      this.illusion.audits.deepened += 1;
    } else {
      this.clearDebt();
      this.illusion.audits.backed += 1;
    }
  }

  /** Seizes real stock toward each debt, clears them all, and counts a missed demand for what stock could not cover. */
  failAudit(context: AddContext): void {
    let uncovered = 0;
    for (const resource of RESOURCES) {
      const owed = this.debtOf(resource);
      const seized = Math.min(owed, this.resources[resource] ?? 0);
      add(this.resources, resource, -seized, context);
      uncovered += (owed - seized) * this.game.economy.priceOf(resource);
    }
    this.clearDebt();
    this.illusion.audits.failed += 1;
    if (uncovered > 0) this.game.crown.recordMiss(uncovered);
  }

  private get isAuditDue(): boolean {
    if (!this.hasDebt) return false;
    const { debtShare, ageTicks } = this.tuning.audit;
    return (
      this.debtValue >= debtShare * this.ceiling ||
      this.game.state.tick - this.illusion.debtSince >= ageTicks
    );
  }

  private runAudit(): void {
    const { tick } = this.game.state;
    const { warningTicks, deadlineTicks } = this.tuning.audit;
    if (
      this.illusion.auditAt !== NO_AUDIT_TICK &&
      tick >= this.illusion.auditAt
    ) {
      this.illusion.auditAt = NO_AUDIT_TICK;
      if (this.hasDebt) this.game.desk.placeAudit(tick + deadlineTicks);
    }
    if (
      this.illusion.auditAt === NO_AUDIT_TICK &&
      !this.game.desk.hasAudit &&
      this.isAuditDue
    ) {
      this.illusion.auditAt = tick + warningTicks;
    }
  }

  /** Plain multiplication, so fading and interest draw nothing from a random stream. */
  run(): void {
    const { conjured, debt } = this.illusion;
    const keep = 1 - this.tuning.fadePerTick;
    const grow = 1 + this.tuning.interestPerTick;
    for (const resource of CONJURABLE) {
      conjured[resource] = this.conjuredOf(resource) * keep;
    }
    for (const resource of RESOURCES) {
      debt[resource] = this.debtOf(resource) * grow;
    }
    this.runAudit();
  }
}
