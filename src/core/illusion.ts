import { z } from "zod";
import { formatAmount, withThousandsSeparators } from "./amount";
import type { CommandResult } from "./commands";
import { copy } from "./copy";
import { addIssue } from "./errors";
import type { Game } from "./game";
import { type AddContext, add, normalizeZero } from "./math";
import { RESOURCES, type Resource } from "./realm";
import { count, nonNegative, positive, positiveInteger } from "./schema";
import type { ResourceId } from "./state";
import { CONJURING, EXACT_DEBT, FORGING } from "./unlocks";

/** Only these can be conjured; the stores of ore and wood are never faked. */
export const CONJURABLE = ["coin", "grain"] as const;

/** Without exact books, debt is shown rounded up to a multiple of this, so a small debt never reads as none. */
export const ROUGH_DEBT_STEP = 10;

/** How debt is shown to the steward: exact to a tenth with exact books, otherwise rounded up and marked approximate. */
export class DebtFigure {
  constructor(readonly exact: boolean) {}

  round(amount: number): number {
    if (amount <= 0) return 0;
    return this.exact
      ? Math.ceil(amount * 10) / 10
      : Math.ceil(amount / ROUGH_DEBT_STEP) * ROUGH_DEBT_STEP;
  }

  /** Rounds an amount and writes it out. */
  describe(amount: number): string {
    return this.text(this.round(amount));
  }

  /** Text for an amount already rounded by `round`. */
  text(rounded: number): string {
    return copy.illusion.figure({
      amount: this.exact
        ? formatAmount(rounded)
        : withThousandsSeparators(String(rounded)),
      exact: this.exact,
    });
  }
}

/** What the steward is told about one resource's debt and what repaying it from real stock would do. */
export type DebtLine = {
  owed: number;
  /** What real stock would repay now, before the debt runs out or the stock does. */
  repayable: number;
  /** The real stock covers the whole debt. */
  covered: boolean;
};

export type Books = "clean" | "thin" | "strained" | "rotten";

export type IllusionState = {
  /** Illusory units sitting in the stores, keyed by conjurable resource. */
  conjured: Record<ResourceId, number>;
  /** Illusory units that were passed off as real, keyed by resource. */
  debt: Record<ResourceId, number>;
  /**
   * What was forged or passed off, keyed by resource. Interest is charged on this rather than on the
   * whole debt so that it never compounds.
   */
  principal: Record<ResourceId, number>;
  /** The tick the debt last rose from zero; see `NO_DEBT_TICK`. */
  debtSince: number;
  /** The tick announced auditors arrive; see `NO_AUDIT_TICK`. */
  auditAt: number;
  /** The tick the last audit was settled or lapsed; see `NO_AUDIT_CLOSED_TICK`. */
  lastAuditClosedAt: number;
  audits: { backed: number; deepened: number; failed: number };
};

const nonNegativeNumber = z.number().min(0);

const amountPerResource = z.strictObject({
  coin: nonNegativeNumber,
  grain: nonNegativeNumber,
  ore: nonNegativeNumber,
  wood: nonNegativeNumber,
});

export const illusionStateSchema: z.ZodType<IllusionState> = z.strictObject({
  conjured: z.strictObject({
    coin: nonNegativeNumber,
    grain: nonNegativeNumber,
  }),
  debt: amountPerResource,
  principal: amountPerResource,
  debtSince: count,
  auditAt: count,
  lastAuditClosedAt: count,
  audits: z.strictObject({ backed: count, deepened: count, failed: count }),
});

/**
 * Stands for "no debt is owed". State validation and `canonicalStringify` reject null, so the
 * absence of debt is stored as a tick no debt can have rise at; ticks start at 1.
 */
export const NO_DEBT_TICK = 0;

/** Stands for "no auditors are on the road", for the same reason as `NO_DEBT_TICK`. */
export const NO_AUDIT_TICK = 0;

/** Stands for "no audit has closed yet", for the same reason as `NO_DEBT_TICK`. */
export const NO_AUDIT_CLOSED_TICK = 0;

export function emptyIllusionState(): IllusionState {
  return {
    conjured: { coin: 0, grain: 0 },
    debt: { coin: 0, grain: 0, ore: 0, wood: 0 },
    principal: { coin: 0, grain: 0, ore: 0, wood: 0 },
    debtSince: NO_DEBT_TICK,
    auditAt: NO_AUDIT_TICK,
    lastAuditClosedAt: NO_AUDIT_CLOSED_TICK,
    audits: { backed: 0, deepened: 0, failed: 0 },
  };
}

export const illusionTuningSchema = z
  .strictObject({
    lot: positive,
    ceilingPerPeasant: positive,
    fadePerTick: z.number().min(0).max(1).transform(normalizeZero),
    interestPerSeason: nonNegative,
    audit: z.strictObject({
      debtShare: positive,
      ageTicks: positiveInteger,
      minGapTicks: positiveInteger,
      warningTicks: positiveInteger,
      deadlineTicks: positiveInteger,
      deepenCost: nonNegative,
      deepenFee: nonNegative,
    }),
    books: z.strictObject({ strained: positive, rotten: positive }),
  })
  .superRefine((value, ctx) => {
    if (value.books.strained >= value.books.rotten) {
      addIssue(ctx, "must be below rotten", ["books", "strained"]);
    }
  });

export type IllusionTuning = z.infer<typeof illusionTuningSchema>;

/** What the steward sees of the illusion; null until conjuring is unlocked. */
export type IllusionView = {
  books: Books;
  /** Coin value of illusion that can still be added before the ceiling. */
  room: number;
  /** Debt per resource, rounded up to the nearest ten unless exact books are owned. */
  debt: Record<ResourceId, DebtLine>;
  /** Debt is shown to the decimal rather than rounded. */
  debtIsExact: boolean;
  /** Announced auditors have not yet reached the desk. */
  auditOnTheRoad: boolean;
  /** Ticks until announced auditors arrive; null when none are on the road or exact books are not owned. */
  auditInTicks: number | null;
};

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

  private get canConjure(): boolean {
    return this.game.unlocks.enabled(CONJURING);
  }

  private get canForge(): boolean {
    return this.game.unlocks.enabled(FORGING);
  }

  view(): IllusionView | null {
    if (!this.canConjure && !this.canForge) return null;
    const { books, room, auditInTicks, showsExactDebt } = this;
    return {
      books,
      room,
      debt: this.debtLines(),
      debtIsExact: showsExactDebt,
      auditOnTheRoad: auditInTicks !== null,
      auditInTicks: showsExactDebt ? auditInTicks : null,
    };
  }

  conjuredOf(resource: ResourceId): number {
    return this.illusion.conjured[resource] ?? 0;
  }

  private debtOf(resource: ResourceId): number {
    return this.illusion.debt[resource] ?? 0;
  }

  private principalOf(resource: ResourceId): number {
    return this.illusion.principal[resource] ?? 0;
  }

  get showsExactDebt(): boolean {
    return this.game.unlocks.enabled(EXACT_DEBT);
  }

  private get debtFigure(): DebtFigure {
    return new DebtFigure(this.showsExactDebt);
  }

  debtLines(): Record<ResourceId, DebtLine> {
    const lines: Record<ResourceId, DebtLine> = {};
    const figure = this.debtFigure;
    for (const resource of RESOURCES) {
      const owed = this.debtOf(resource);
      const held = this.resources[resource] ?? 0;
      lines[resource] = {
        owed: figure.round(owed),
        repayable: figure.round(Math.min(owed, held)),
        covered: held >= owed,
      };
    }
    return lines;
  }

  /** What the village appears to hold: the real stock plus the conjured units. */
  apparent(resource: ResourceId): number {
    return (this.resources[resource] ?? 0) + this.conjuredOf(resource);
  }

  get hasDebt(): boolean {
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
      this.tuning.ceilingPerPeasant *
      this.game.crown.ceilingFactor *
      this.game.delegates.population
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
    this.illusion.principal[resource] = this.principalOf(resource) + amount;
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
    if (!this.canConjure) {
      return { ok: false, reason: copy.illusion.cannotConjureYet };
    }
    if (!(CONJURABLE as readonly string[]).includes(resource)) {
      return {
        ok: false,
        reason: copy.illusion.cannotBeConjured({ resource }),
      };
    }
    if (amount <= 0) {
      return { ok: false, reason: copy.illusion.conjureAmountMustBePositive };
    }
    const cost = amount * this.game.economy.priceOf(resource);
    if (cost > this.room) {
      return {
        ok: false,
        reason: copy.illusion.ceilingLeavesRoomFor({
          coin: String(Math.floor(this.room)),
        }),
      };
    }
    this.illusion.conjured[resource] = this.conjuredOf(resource) + amount;
    return {
      ok: true,
      message: copy.illusion.conjureDone({
        amount: String(amount),
        resource,
      }),
    };
  }

  private get forgeRefusal(): CommandResult | null {
    if (!this.canForge) {
      return { ok: false, reason: copy.illusion.cannotForgeYet };
    }
    if (!this.game.crown.isOpen) {
      return { ok: false, reason: copy.crown.noDemand };
    }
    return null;
  }

  /** Marks as much of what the crown still wants as the room allows as delivered on paper. */
  forge(context: AddContext): CommandResult {
    const refusal = this.forgeRefusal;
    if (refusal) return refusal;

    const { crown } = this.game;
    if (this.room <= 0) {
      return { ok: false, reason: copy.illusion.ceilingLeavesNoRoom };
    }
    const resource = this.game.state.posting.crown.demand.resource;
    const price = this.game.economy.priceOf(resource as Resource);
    const forged = Math.min(crown.owed, this.room / price);
    this.owe(resource, forged);
    crown.credit(forged, context);
    return { ok: true };
  }

  /**
   * Forges whatever the stores cannot deliver. Delivering first is what keeps the forged amount,
   * and so the debt, as small as the stores allow; a refusal from the delivery only means there was
   * nothing held to hand over.
   */
  forgeMissing(context: AddContext): CommandResult {
    const refusal = this.forgeRefusal;
    if (refusal) return refusal;
    const { crown } = this.game;
    crown.deliver(context);
    return crown.isOpen ? this.forge(context) : { ok: true };
  }

  private repay(
    resource: ResourceId,
    amount: number,
    context: AddContext,
  ): void {
    add(this.resources, resource, -amount, context);
    this.illusion.debt[resource] = this.debtOf(resource) - amount;
    this.illusion.principal[resource] = Math.max(
      0,
      this.principalOf(resource) - amount,
    );
    if (!RESOURCES.some((id) => this.debtOf(id) > 0)) {
      this.illusion.debtSince = NO_DEBT_TICK;
    }
  }

  /** Repays debt from real stock alone, as far as the stock reaches. */
  back(resource: Resource, context: AddContext): CommandResult {
    const owed = this.debtOf(resource);
    if (owed <= 0) {
      return { ok: false, reason: copy.illusion.noDebtToBack({ resource }) };
    }
    const held = this.resources[resource] ?? 0;
    if (held <= 0) {
      return {
        ok: false,
        reason: copy.illusion.villageHoldsNoneToBack({ resource }),
      };
    }
    const repaid = Math.min(owed, held);
    this.repay(resource, repaid, context);
    const left = owed - repaid;
    const figure = this.debtFigure;
    return {
      ok: true,
      message:
        left > 0
          ? copy.illusion.repaidPartly({
              resource,
              repaid: figure.describe(repaid),
              left: figure.describe(left),
            })
          : copy.illusion.repaidAll({
              resource,
              repaid: figure.describe(repaid),
            }),
    };
  }

  /** Ticks until announced auditors reach the desk; null when none are on the road. */
  get auditInTicks(): number | null {
    const { auditAt } = this.illusion;
    return auditAt === NO_AUDIT_TICK ? null : auditAt - this.game.state.tick;
  }

  private get deepenCost(): number {
    return this.tuning.audit.deepenCost * this.debtValue;
  }

  /** The cost of an audit option as negative deltas, worked out from the debt as it stands. */
  auditCost(optionId: string): Record<string, number> {
    if (optionId === "deepen") return { coin: -this.deepenCost };
    const cost: Record<string, number> = {};
    for (const resource of RESOURCES) {
      if (this.debtOf(resource) > 0) cost[resource] = -this.debtOf(resource);
    }
    return cost;
  }

  /** Pays an audit option's cost from real stock and applies its effect; the caller checked it is affordable. */
  settleAudit(optionId: string, context: AddContext): void {
    if (optionId === "deepen") {
      add(this.resources, "coin", -this.deepenCost, context);
      this.chargeOnPrincipal(this.tuning.audit.deepenFee);
      this.illusion.debtSince = this.game.state.tick;
      this.passAudit("deepened");
    } else {
      for (const resource of RESOURCES) {
        this.repay(resource, this.debtOf(resource), context);
      }
      this.passAudit("backed");
    }
  }

  private closeAudit(outcome: keyof IllusionState["audits"]): void {
    this.illusion.audits[outcome] += 1;
    this.illusion.lastAuditClosedAt = this.game.state.tick;
  }

  private passAudit(outcome: "backed" | "deepened"): void {
    this.closeAudit(outcome);
    this.game.crown.recordAudit(outcome);
  }

  failAudit(context: AddContext): void {
    let uncovered = 0;
    for (const resource of RESOURCES) {
      const owed = this.debtOf(resource);
      const held = this.resources[resource] ?? 0;
      const seized = Math.min(
        owed,
        held - this.game.crown.reservedOf(resource),
      );
      this.repay(resource, seized, context);
      uncovered += (owed - seized) * this.game.economy.priceOf(resource);
    }
    for (const resource of RESOURCES) {
      this.illusion.debt[resource] = 0;
      this.illusion.principal[resource] = 0;
    }
    this.illusion.debtSince = NO_DEBT_TICK;
    this.closeAudit("failed");
    this.game.crown.recordFailedAudit(uncovered);
    this.game.governors.dismissAfterFailedAudit(context);
  }

  private get warningTicks(): number {
    return Math.round(
      this.tuning.audit.warningTicks * this.game.crown.warningFactor,
    );
  }

  /** The shortest time between one audit closing and the next being announced. */
  get auditGapTicks(): number {
    return this.tuning.audit.minGapTicks + this.game.crown.auditGapBonus;
  }

  private get isInAuditGap(): boolean {
    const { lastAuditClosedAt } = this.illusion;
    return (
      lastAuditClosedAt !== NO_AUDIT_CLOSED_TICK &&
      this.game.state.tick - lastAuditClosedAt < this.auditGapTicks
    );
  }

  private get isAuditDue(): boolean {
    if (!this.hasDebt || this.isInAuditGap) return false;
    const { debtShare, ageTicks } = this.tuning.audit;
    const share = debtShare * this.game.crown.debtShareFactor;
    return (
      this.debtValue >= share * this.ceiling ||
      this.game.state.tick - this.illusion.debtSince >= ageTicks
    );
  }

  private runAudit(): void {
    if (!this.hasDebt && this.game.desk.hasAudit) {
      this.game.desk.removeAudit();
      this.passAudit("backed");
    }
    const { tick } = this.game.state;
    const { deadlineTicks } = this.tuning.audit;
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
      this.illusion.auditAt = tick + this.warningTicks;
    }
  }

  /** Charges are taken on the principal alone so that interest and fees never compound. */
  private chargeOnPrincipal(rate: number): void {
    for (const resource of RESOURCES) {
      this.illusion.debt[resource] =
        this.debtOf(resource) + this.principalOf(resource) * rate;
    }
  }

  /** Plain arithmetic, so fading and interest draw nothing from a random stream. */
  run(): void {
    const { conjured } = this.illusion;
    const keep = 1 - this.tuning.fadePerTick;
    for (const resource of CONJURABLE) {
      conjured[resource] = this.conjuredOf(resource) * keep;
    }
    if (this.game.economy.seasonEnds) {
      this.chargeOnPrincipal(this.tuning.interestPerSeason);
    }
    this.runAudit();
  }
}
