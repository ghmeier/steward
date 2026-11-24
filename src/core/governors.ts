import { z } from "zod";
import type { Governor } from "./delegates";
import type { Candidate } from "./desk";
import { addIssue } from "./errors";
import type { Game } from "./game";
import { type AddContext, add } from "./math";
import {
  Job,
  RESOURCES,
  type Resource,
  TRAITS,
  type Trait,
  WORKING_JOBS,
} from "./realm";
import { chance, drawDelay, intBelow, type RngState } from "./rng";
import {
  count,
  name,
  positive,
  positiveInteger,
  tickRange,
  traitList,
} from "./schema";
import { GOVERNORS, TRUE_REPORTS } from "./unlocks";

/** A governor chosen to go with the steward to the next posting; the new posting draws their village, job and term. */
export type Follower = {
  name: string;
  traits: Trait[];
  loyalty: number;
};

export const followerSchema: z.ZodType<Follower> = z.strictObject({
  name: z.string().min(1),
  traits: traitList,
  loyalty: count,
});

export type DepartureReason = "retired" | "died" | "dismissed";

export type FormerGovernor = {
  name: string;
  traits: Trait[];
  hiredAt: number;
  leftAt: number;
  reason: DepartureReason;
  /** Coin the governor had kept back, which they handed over on leaving. */
  handedOver: number;
  /** The loyalty the governor left with; nothing for a dismissed governor, whose hoard was taken back. */
  loyalty: number;
  /** What the governor died of; absent for one who retired or was dismissed. */
  cause?: string | undefined;
};

export const formerGovernorSchema: z.ZodType<FormerGovernor> = z.strictObject({
  name: z.string().min(1),
  traits: traitList,
  hiredAt: count,
  leftAt: count,
  reason: z.enum(["retired", "died", "dismissed"]),
  handedOver: z.number().min(0),
  loyalty: count,
  cause: name.optional(),
});

/** What a candidate on the desk offers, drawn when they arrive so the player sees it before choosing. */
export type CandidateDetails = {
  name: string;
  job: Job;
  village: number;
  traits: Trait[];
  price: number;
  /** Ticks the governor serves once hired. */
  term: number;
};

const countRange = z
  .strictObject({ min: positiveInteger, max: positiveInteger })
  .superRefine((range, ctx) => {
    if (range.min > range.max) addIssue(ctx, "must not exceed max", ["min"]);
  });

export const governorTuningSchema = z.strictObject({
  cap: positiveInteger,
  village: countRange,
  term: tickRange,
  deathPerMille: z.int().min(0).max(1000),
  causes: z.array(name).min(1),
  price: countRange,
  empireBuilderLimit: positiveInteger,
  loyalty: z.strictObject({
    perSeason: count,
    backedAudit: count,
    missedDemand: count,
    /** What loyalty becomes when the governor's hoard is seized. */
    seized: count,
    /** The loyalty at which a governor will follow the steward. */
    followAt: positiveInteger,
    followerCap: count,
  }),
  traits: z.record(
    z.enum(TRAITS),
    z.strictObject({ output: positive, report: positive }),
  ),
});

export type GovernorTuning = z.infer<typeof governorTuningSchema>;

/** The traits one governor holds; each factor is the product over those traits, so no caller recomputes it. */
class TraitSet {
  constructor(
    private traits: readonly Trait[],
    private table: GovernorTuning["traits"],
  ) {}

  private product(key: "output" | "report"): number {
    return this.traits.reduce(
      (factor, trait) => factor * this.table[trait][key],
      1,
    );
  }

  get output(): number {
    return this.product("output");
  }

  get report(): number {
    return this.product("report");
  }

  has(trait: Trait): boolean {
    return this.traits.includes(trait);
  }
}

export type LoyaltyStanding = "wary" | "steady" | "devoted";

export type GovernorView = {
  id: number;
  name: string;
  job: Job;
  village: number;
  traits: Trait[];
  /** What the governor's job yields; null for one with no work. */
  resource: Resource | null;
  /** What the governor claims to bring in each second of their job's resource; real output scaled by their report factor. */
  reportedPerSecond: number;
  /** What the governor really brings in and how far the report overshoots it; null until true reports are bought. */
  truth: { realPerSecond: number; gapPerSecond: number } | null;
  /** Whole seasons until the term ends, counting the one in progress; the governor may die sooner. */
  seasonsLeft: number;
  standing: LoyaltyStanding;
};
/** A governor who has left, oldest first, so a change in the list's length is a new departure. */
export type FormerGovernorView = {
  name: string;
  reason: DepartureReason;
  /** Coin the governor kept back and handed over on leaving; 0 for one who kept none. */
  handedOver: number;
  cause?: string | undefined;
};

export class GovernorManager {
  constructor(private game: Game) {}

  private get tuning() {
    return this.game.tuning.governors;
  }

  private get roster(): Governor[] {
    return this.game.delegates.governors;
  }

  private get stream(): RngState {
    const stream = this.game.state.posting.rng.governors;
    if (stream === undefined)
      throw new Error("the governors stream is missing");
    return stream;
  }

  get cap(): number {
    return this.tuning.cap + this.game.unlocks.modifier("governorSlots");
  }

  get deathPerMille(): number {
    return Math.round(
      this.tuning.deathPerMille * this.game.unlocks.modifier("governorDeath"),
    );
  }

  get hasRoom(): boolean {
    return this.roster.length < this.cap;
  }

  /** Candidates arrive only once governors are bought, and only while hiring them all would stay within the cap. */
  get canOffer(): boolean {
    return (
      this.game.unlocks.enabled(GOVERNORS) &&
      this.roster.length + this.game.desk.candidates.length < this.cap
    );
  }

  private traitsOf(governor: Governor): TraitSet {
    return new TraitSet(governor.traits, this.tuning.traits);
  }

  /** Workers the governor actually puts to work: the village scaled by trait output. */
  workersOf(governor: Governor): number {
    return governor.village * this.traitsOf(governor).output;
  }

  /** Workers the governor claims, which exceeds the real figure for a skimmer, braggart or empire-builder. */
  reportedWorkersOf(governor: Governor): number {
    return this.workersOf(governor) * this.traitsOf(governor).report;
  }

  private isWorking(governor: Governor, tick: number): boolean {
    return tick >= governor.grudgeUntil && governor.job !== Job.IDLE;
  }

  /** The resource the governor's job yields per worker per tick; null when idle. */
  private yieldOf(governor: Governor, tick: number) {
    return this.isWorking(governor, tick)
      ? this.game.economy.yieldPerWorker(governor.job, tick)
      : null;
  }

  /** What the governor really brings in per tick of their job's resource. */
  realOutput(governor: Governor, tick: number): number {
    const yielded = this.yieldOf(governor, tick);
    return yielded === null ? 0 : this.workersOf(governor) * yielded.amount;
  }

  /** What the governor claims to bring in per tick of their job's resource. */
  reportedOutput(governor: Governor, tick: number): number {
    const yielded = this.yieldOf(governor, tick);
    return yielded === null
      ? 0
      : this.reportedWorkersOf(governor) * yielded.amount;
  }

  /** Devoted is the loyalty at which a governor follows; steady is half of that, rounded up. */
  private standingOf(loyalty: number): LoyaltyStanding {
    const { followAt } = this.tuning.loyalty;
    if (loyalty >= followAt) return "devoted";
    return loyalty >= Math.ceil(followAt / 2) ? "steady" : "wary";
  }

  view(): GovernorView[] {
    const trueReports = this.game.unlocks.enabled(TRUE_REPORTS);
    const { stepMs, economy } = this.game.tuning;
    const { ticksPerSeason } = economy;
    const perSecond = (perTick: number) => (perTick * 1000) / stepMs;
    // The projection runs the next tick, so output is read at that tick too.
    const tick = this.game.state.tick + 1;
    return this.roster.map((governor) => {
      const reported = this.reportedOutput(governor, tick);
      const real = this.realOutput(governor, tick);
      return {
        id: governor.id,
        name: governor.name,
        job: governor.job,
        village: governor.village,
        traits: [...governor.traits],
        resource:
          this.game.economy.yieldPerWorker(governor.job, tick)?.resource ??
          null,
        reportedPerSecond: perSecond(reported),
        truth: trueReports
          ? {
              realPerSecond: perSecond(real),
              gapPerSecond: perSecond(reported - real),
            }
          : null,
        seasonsLeft: Math.ceil(
          (governor.termEndsAt - this.game.state.tick) / ticksPerSeason,
        ),
        standing: this.standingOf(governor.loyalty),
      };
    });
  }

  formerView(): FormerGovernorView[] {
    return this.game.state.posting.formerStaff.map(
      ({ name, reason, handedOver, cause }) => ({
        name,
        reason,
        handedOver,
        cause,
      }),
    );
  }

  /** Reported minus real output per tick for each resource, which the ledger adds to its displayed rates. */
  reportGap(tick: number): Record<Resource, number> {
    const gap = {} as Record<Resource, number>;
    for (const resource of RESOURCES) gap[resource] = 0;
    for (const governor of this.roster) {
      const yielded = this.yieldOf(governor, tick);
      if (yielded === null) continue;
      gap[yielded.resource] +=
        (this.reportedWorkersOf(governor) - this.workersOf(governor)) *
        yielded.amount;
    }
    return gap;
  }

  private between(range: { min: number; max: number }): number {
    return range.min + intBelow(this.stream, range.max - range.min + 1);
  }

  private drawTraits(): Trait[] {
    const pool = [...TRAITS];
    const picked: Trait[] = [];
    for (let count = 1 + intBelow(this.stream, 2); count > 0; count--) {
      picked.push(...pool.splice(intBelow(this.stream, pool.length), 1));
    }
    return picked.sort();
  }

  private pick<Item>(items: readonly Item[]): Item {
    return items[intBelow(this.stream, items.length)] as Item;
  }

  drawCandidate(): CandidateDetails {
    return {
      name: this.game.delegates.findName(),
      job: this.pick(WORKING_JOBS),
      village: this.between(this.tuning.village),
      traits: this.drawTraits(),
      price: this.between(this.tuning.price),
      term: drawDelay(this.stream, this.tuning.term),
    };
  }

  hire(candidate: Candidate, context: AddContext): void {
    this.game.illusion.spend("coin", candidate.price, context);
    const { tick } = this.game.state;
    this.game.delegates.createGovernor({
      name: candidate.name,
      job: candidate.job,
      village: candidate.village,
      traits: [...candidate.traits],
      hiredAt: tick,
      termEndsAt: tick + candidate.term,
      hoard: 0,
      loyalty: 0,
    });
  }

  /**
   * Seats each follower in a new posting as a governor with a freshly drawn village, job and term. Those
   * draws come from the governors stream, which the new posting has not used yet, so arrival is deterministic.
   */
  seat(followers: readonly Follower[]): void {
    const { tick } = this.game.state;
    for (const follower of followers) {
      this.game.delegates.createGovernor({
        name: follower.name,
        job: this.pick(WORKING_JOBS),
        village: this.between(this.tuning.village),
        traits: [...follower.traits],
        hiredAt: tick,
        termEndsAt: tick + drawDelay(this.stream, this.tuning.term),
        hoard: 0,
        loyalty: follower.loyalty,
      });
    }
  }

  /**
   * The most loyal governors at or above the threshold, up to the cap. Ties go to whoever has served
   * longest, then to the lower id, so the same roster always sends the same followers.
   */
  chooseFollowers(): Follower[] {
    const { followAt, followerCap } = this.tuning.loyalty;
    return this.roster
      .filter((governor) => governor.loyalty >= followAt)
      .sort(
        (a, b) => b.loyalty - a.loyalty || a.hiredAt - b.hiredAt || a.id - b.id,
      )
      .slice(0, followerCap)
      .map(({ name, traits, loyalty }) => ({
        name,
        traits: [...traits],
        loyalty,
      }));
  }

  /** Every governor serving when an audit is backed gains the same loyalty. */
  recordBackedAudit(): void {
    for (const governor of this.roster) {
      governor.loyalty += this.tuning.loyalty.backedAudit;
    }
  }

  recordMissedDemand(): void {
    for (const governor of this.roster) {
      governor.loyalty = Math.max(
        0,
        governor.loyalty - this.tuning.loyalty.missedDemand,
      );
    }
  }

  private depart(
    governor: Governor,
    reason: DepartureReason,
    context: AddContext,
    cause?: string,
  ): void {
    const { posting, tick } = this.game.state;
    add(posting.resources, "coin", governor.hoard, context);
    posting.formerStaff.push({
      name: governor.name,
      traits: [...governor.traits],
      hiredAt: governor.hiredAt,
      leftAt: tick,
      reason,
      handedOver: governor.hoard,
      // A dismissed governor's hoard is taken back by the audit, which ends any attachment to the steward.
      loyalty:
        reason === "dismissed" ? this.tuning.loyalty.seized : governor.loyalty,
      cause,
    });
    this.game.delegates.remove(governor.id);
  }

  private exaggerationOf(governor: Governor): number {
    return this.reportedWorkersOf(governor) - this.workersOf(governor);
  }

  /** Blames whoever inflated their reports the most, or the newest hire when every report was honest. */
  dismissAfterFailedAudit(context: AddContext): void {
    const [worst] = [...this.roster].sort(
      (a, b) => this.exaggerationOf(b) - this.exaggerationOf(a),
    );
    const blamed =
      worst !== undefined && this.exaggerationOf(worst) > 0
        ? worst
        : this.roster.at(-1);
    if (blamed !== undefined) this.depart(blamed, "dismissed", context);
  }

  // A hoarder keeps the share of the village's work their trait takes off the output, valued in coin.
  private keepBack(governor: Governor, tick: number): void {
    if (!this.traitsOf(governor).has("hoarder")) return;
    const yielded = this.yieldOf(governor, tick);
    if (yielded === null) return;
    const hoarderOutput = this.tuning.traits.hoarder.output;
    const workersBeforeCut = this.workersOf(governor) / hoarderOutput;
    const kept = Math.max(0, workersBeforeCut * (1 - hoarderOutput));
    governor.hoard +=
      kept * yielded.amount * this.game.economy.priceOf(yielded.resource);
  }

  /** Ends terms, rolls each season's chance of death and grows empire-builders' villages. */
  run(context: AddContext): void {
    const { tick } = this.game.state;
    const { seasonEnds } = this.game.economy;
    for (const governor of this.roster) {
      this.keepBack(governor, tick);
      if (tick >= governor.termEndsAt) {
        this.depart(governor, "retired", context);
      } else if (seasonEnds && chance(this.stream, this.deathPerMille)) {
        this.depart(governor, "died", context, this.pick(this.tuning.causes));
      } else if (seasonEnds) {
        governor.loyalty += this.tuning.loyalty.perSeason;
        if (
          this.traitsOf(governor).has("empire-builder") &&
          governor.village < this.tuning.empireBuilderLimit
        ) {
          governor.village += 1;
        }
      }
    }
  }
}
