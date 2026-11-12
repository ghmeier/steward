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
import { count, positive, positiveInteger, traitList } from "./schema";
import { TRUE_REPORTS } from "./unlocks";

export type DepartureReason = "retired" | "died" | "dismissed";

export type FormerGovernor = {
  name: string;
  traits: Trait[];
  hiredAt: number;
  leftAt: number;
  reason: DepartureReason;
  /** Coin the governor had kept back, which they handed over on leaving. */
  handedOver: number;
};

export const formerGovernorSchema: z.ZodType<FormerGovernor> = z.strictObject({
  name: z.string().min(1),
  traits: traitList,
  hiredAt: count,
  leftAt: count,
  reason: z.enum(["retired", "died", "dismissed"]),
  handedOver: z.number().min(0),
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

const tickRange = z
  .strictObject({ minTicks: positiveInteger, maxTicks: positiveInteger })
  .superRefine((range, ctx) => {
    if (range.minTicks > range.maxTicks) {
      addIssue(ctx, "must not exceed maxTicks", ["minTicks"]);
    }
  });

export const governorTuningSchema = z.strictObject({
  cap: positiveInteger,
  village: countRange,
  term: tickRange,
  deathPerMille: z.int().min(0).max(1000),
  price: countRange,
  empireBuilderLimit: positiveInteger,
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

export type GovernorView = {
  id: number;
  name: string;
  job: Job;
  village: number;
  traits: Trait[];
  /** What the governor claims to bring in each second of their job's resource; real output scaled by their report factor. */
  reportedPerSecond: number;
  /** What the governor really brings in and how far the report overshoots it; null until true reports are bought. */
  truth: { realPerSecond: number; gapPerSecond: number } | null;
};
/** A governor who has left, oldest first, so a change in the list's length is a new departure. */
export type FormerGovernorView = {
  name: string;
  reason: DepartureReason;
  /** Coin the governor kept back and handed over on leaving; 0 for one who kept none. */
  handedOver: number;
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

  get hasRoom(): boolean {
    return this.roster.length < this.tuning.cap;
  }

  /** Candidates arrive only after promotion, and only while hiring them all would stay within the cap. */
  get canOffer(): boolean {
    return (
      this.game.state.career.promotedAt !== 0 &&
      this.roster.length + this.game.desk.candidates.length < this.tuning.cap
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

  view(): GovernorView[] {
    const trueReports = this.game.unlocks.enabled(TRUE_REPORTS);
    const { stepMs } = this.game.tuning;
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
        reportedPerSecond: perSecond(reported),
        truth: trueReports
          ? {
              realPerSecond: perSecond(real),
              gapPerSecond: perSecond(reported - real),
            }
          : null,
      };
    });
  }

  formerView(): FormerGovernorView[] {
    return this.game.state.posting.formerStaff.map(
      ({ name, reason, handedOver }) => ({ name, reason, handedOver }),
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
    });
  }

  private depart(
    governor: Governor,
    reason: DepartureReason,
    context: AddContext,
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
    const seasonEnds = tick % this.game.tuning.economy.ticksPerSeason === 0;
    for (const governor of this.roster) {
      this.keepBack(governor, tick);
      if (tick >= governor.termEndsAt) {
        this.depart(governor, "retired", context);
      } else if (seasonEnds && chance(this.stream, this.tuning.deathPerMille)) {
        this.depart(governor, "died", context);
      } else if (
        seasonEnds &&
        this.traitsOf(governor).has("empire-builder") &&
        governor.village < this.tuning.empireBuilderLimit
      ) {
        governor.village += 1;
      }
    }
  }
}
