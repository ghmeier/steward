import { z } from "zod";
import type { ResourcePetition } from "./decree";
import { addIssue } from "./errors";
import type { Game } from "./game";
import { NO_LABOR_POLICY } from "./labor";
import { LaborSplit } from "./labor-split";
import { type AddContext, add } from "./math";
import {
  Job,
  RESOURCES,
  type Resource,
  SEASONS,
  type Season,
  WORKING_JOBS,
  type WorkingJob,
} from "./realm";
import {
  count,
  name,
  nonNegative,
  positive,
  positiveInteger,
  repeatIssues,
} from "./schema";

export type Famine = {
  startPopulation: number;
  ticks: number;
  deaths: number;
};

export type EconomyState = {
  famine: Famine;
  growth: number;
  starved: number;
};

export const economyStateSchema: z.ZodType<EconomyState> = z.strictObject({
  famine: z.strictObject({
    startPopulation: count,
    ticks: count,
    deaths: count,
  }),
  growth: z.number().min(0),
  starved: count,
});

export function emptyEconomyState(): EconomyState {
  return {
    famine: { startPopulation: 0, ticks: 0, deaths: 0 },
    growth: 0,
    starved: 0,
  };
}

const laborAllocations = z
  .record(
    z.string(),
    z.record(z.enum(WORKING_JOBS), nonNegative).superRefine((shares, ctx) => {
      let total = 0;
      for (const job of WORKING_JOBS) total += shares[job];
      if (Math.abs(total - 1) > 1e-9) {
        addIssue(ctx, "shares must sum to 1");
      }
    }),
  )
  .superRefine((allocations, ctx) => {
    if (Object.keys(allocations).length === 0) {
      addIssue(ctx, "must not be empty");
    }
  });

export const economyTuningSchema = z
  .strictObject({
    ticksPerSeason: positiveInteger,
    seasonYield: z.record(z.enum(SEASONS), nonNegative),
    grainPerFarmer: nonNegative,
    woodPerWorker: nonNegative,
    orePerWorker: nonNegative,
    grainPerPerson: nonNegative,
    idleGrainFactor: z.number().min(0).max(1),
    grainPrice: nonNegative,
    woodPrice: nonNegative,
    orePrice: nonNegative,
    grainPerPeasant: positive,
    maxPopulation: positiveInteger,
    laborMovesPerTick: positiveInteger,
    initialPopulation: z.int().min(0),
    initialResources: z.record(z.enum(RESOURCES), nonNegative),
    /** What the stores hold before any upgrade; coin has no store and so no cap. */
    caps: z.strictObject({ grain: positive, wood: positive, ore: positive }),
    laborAllocations,
  })
  .superRefine((value, ctx) => {
    if (value.initialPopulation > value.maxPopulation) {
      addIssue(ctx, "must not exceed maxPopulation", ["initialPopulation"]);
    }
  });

export const villageTuningSchema = z.strictObject({
  names: z
    .array(name)
    .superRefine((names, ctx) => repeatIssues(names, "name", ctx)),
  promotionPopulation: positiveInteger,
  /** Names a new village may be given by default; distinct from the peasants' names. */
  villageNames: z
    .array(name)
    .min(1)
    .superRefine((names, ctx) => repeatIssues(names, "village name", ctx)),
  /** The ranks the steward climbs, by the milestone that earns each. */
  titles: z.strictObject({
    start: name,
    promoted: name,
    crowned: name,
  }),
});

export type EconomyTuning = z.infer<typeof economyTuningSchema>;
export type VillageTuning = z.infer<typeof villageTuningSchema>;

export type EconomyRun = { flows: EconomyFlows; eaten: number };
export type EconomyFlows = Readonly<Record<ResourcePetition, number>>;

const CAP_MODIFIER = {
  grain: "grainCap",
  wood: "woodCap",
  ore: "oreCap",
} as const;

const YIELD_MODIFIER = {
  [Job.FARM]: "farmYield",
  [Job.FOREST]: "forestYield",
  [Job.MINE]: "mineYield",
} as const;

const PRICE_KEY = {
  grain: "grainPrice",
  wood: "woodPrice",
  ore: "orePrice",
} as const;

export class EconomyManager {
  constructor(private game: Game) {}

  private get posting() {
    return this.game.state.posting;
  }

  private get tick() {
    return this.game.state.tick;
  }

  private get tuning() {
    return this.game.tuning;
  }

  /** Everyone who eats: peasants and the villages governors run. */
  private get population() {
    return this.game.delegates.population;
  }

  /** The peasants alone; labor decrees and famine act on them, never on a governor. */
  private get peasantCount() {
    return this.game.delegates.peasants.length;
  }

  private get ticksPerSeason() {
    return this.tuning.economy.ticksPerSeason;
  }

  private get laborMovesPerTick() {
    return this.tuning.economy.laborMovesPerTick;
  }

  private get grainPerPerson() {
    return this.tuning.economy.grainPerPerson;
  }

  private get seasonYield() {
    return this.tuning.economy.seasonYield;
  }

  get seasonEnds(): boolean {
    return this.tick % this.ticksPerSeason === 0;
  }

  seasonAt(tick: number): Season {
    if (tick < 1) return "spring";
    const index = Math.floor((tick - 1) / this.ticksPerSeason) % SEASONS.length;
    return SEASONS[index] ?? "spring";
  }

  /**
   * Grain the village eats in one tick. A peasant with no job, whether unassigned or idled by a grudge,
   * eats only the idle share; governors' villages count as working. Every reading of the upkeep goes
   * through here so the Ledger, the crown's reserve and the real consumption cannot disagree.
   */
  grainUpkeepPerTick(): number {
    const idle = this.game.delegates.peasants.filter(
      (peasant) => peasant.job === Job.IDLE || this.tick < peasant.grudgeUntil,
    ).length;
    const { idleGrainFactor } = this.tuning.economy;
    const eaters = this.population - idle + idle * idleGrainFactor;
    return eaters * this.grainPerPerson;
  }

  /** Grain the whole village eats in one season at the current population and jobs. */
  grainUpkeepPerSeason(): number {
    return this.grainUpkeepPerTick() * this.ticksPerSeason;
  }

  grainSeasons(): number {
    const grain = this.posting.resources.grain ?? 0;
    const upkeepPerSeason = this.grainUpkeepPerSeason();
    if (upkeepPerSeason === 0)
      return grain === 0 ? 0 : this.tuning.maxResourceValue;
    return grain / upkeepPerSeason;
  }

  /** The most of a resource the stores hold; coin is never stored, so it is never capped. */
  capOf(resource: string): number {
    if (!Object.hasOwn(CAP_MODIFIER, resource)) return Number.POSITIVE_INFINITY;
    const kind = resource as keyof typeof CAP_MODIFIER;
    return (
      this.tuning.economy.caps[kind] +
      this.game.unlocks.modifier(CAP_MODIFIER[kind])
    );
  }

  /** Grain one farmer yields in a tick before the season's multiplier. */
  get grainPerFarmer(): number {
    return (
      this.tuning.economy.grainPerFarmer *
      this.game.unlocks.modifier(YIELD_MODIFIER[Job.FARM])
    );
  }

  get woodPerWorker(): number {
    return (
      this.tuning.economy.woodPerWorker *
      this.game.unlocks.modifier(YIELD_MODIFIER[Job.FOREST])
    );
  }

  get orePerWorker(): number {
    return (
      this.tuning.economy.orePerWorker *
      this.game.unlocks.modifier(YIELD_MODIFIER[Job.MINE])
    );
  }

  /** What one worker on the job yields in a tick at the given tick; null for idle. Every reading of output goes through here. */
  yieldPerWorker(
    job: Job,
    tick: number,
  ): { resource: Resource; amount: number } | null {
    switch (job) {
      case Job.FARM:
        return {
          resource: "grain",
          amount: this.grainPerFarmer * this.seasonYield[this.seasonAt(tick)],
        };
      case Job.FOREST:
        return { resource: "wood", amount: this.woodPerWorker };
      case Job.MINE:
        return { resource: "ore", amount: this.orePerWorker };
      case Job.IDLE:
        return null;
    }
  }

  private producedBy(job: WorkingJob, workers: number): number {
    return workers * (this.yieldPerWorker(job, this.tick)?.amount ?? 0);
  }

  // Idle peasants die first so that a starving village loses its workers last; among
  // workers the order is fixed (mine, forest, farm) so replay never depends on state shape.
  private killOnePeasant(): void {
    const victim =
      this.game.delegates.firstWithJob(Job.IDLE) ??
      this.game.delegates.firstWithJob(Job.MINE) ??
      this.game.delegates.firstWithJob(Job.FOREST) ??
      this.game.delegates.firstWithJob(Job.FARM);
    if (victim !== undefined) this.game.delegates.remove(victim.id);
  }
  // Only peasants can starve, so deaths are paced against the starting peasants: a famine takes at
  // most half of them, spread evenly over one season, and integer arithmetic keeps the schedule exact.
  private advanceFamine(): void {
    const famine = this.posting.economy.famine;
    if (famine.ticks === 0) famine.startPopulation = this.peasantCount;
    famine.ticks += 1;
    const cap = Math.floor(famine.startPopulation / 2);
    const due = Math.min(
      cap,
      Math.floor((famine.ticks * cap) / this.tuning.economy.ticksPerSeason),
    );
    while (famine.deaths < due && this.peasantCount > 0) {
      this.killOnePeasant();
      famine.deaths += 1;
      this.posting.economy.starved += 1;
    }
  }

  run(context: AddContext): EconomyRun {
    const resources = this.posting.resources;
    const { economy } = this.posting;
    const working = this.game.delegates.workingCountsAt(this.tick);

    const produced = this.producedBy(Job.FARM, working.farm);
    const woodCut = this.producedBy(Job.FOREST, working.forest);
    const oreDug = this.producedBy(Job.MINE, working.mine);
    add(resources, "wood", woodCut, context);
    add(resources, "ore", oreDug, context);

    const upkeep = this.grainUpkeepPerTick();
    const grain = resources.grain ?? 0;
    const eaten = Math.min(grain + produced, upkeep);
    if (grain + produced >= upkeep) {
      // The village eats before the harvest is stored, so a full granary shows no false drain: only
      // what the cap turns away is lost.
      add(resources, "grain", -upkeep, context);
      add(resources, "grain", produced, context);
      economy.famine = { startPopulation: 0, ticks: 0, deaths: 0 };
    } else {
      add(resources, "grain", produced, context);
      add(resources, "grain", -(resources.grain ?? 0), context);
      this.advanceFamine();
    }

    return {
      flows: {
        harvest: Math.max(0, produced - upkeep),
        wood: woodCut,
        ore: oreDug,
      },
      eaten,
    };
  }

  /** What a unit of the resource sells for at market, in coin. */
  priceOf(resource: Resource): number {
    return resource === "coin"
      ? 1
      : this.tuning.economy[PRICE_KEY[resource]] *
          this.game.unlocks.modifier("sellPrice");
  }

  sellResource(
    resource: keyof typeof PRICE_KEY,
    amount: number,
    context: AddContext,
  ): void {
    const resources = this.posting.resources;
    add(resources, resource, -amount, context);
    add(resources, "coin", amount * this.priceOf(resource), context);
  }

  feedGrain(amount: number, context: AddContext): void {
    const { grainPerPeasant } = this.tuning.economy;
    const { economy } = this.posting;
    if (!this.hasRoom) return;

    add(this.posting.resources, "grain", -amount, context);
    economy.growth += amount;
    while (economy.growth >= grainPerPeasant && this.hasRoom) {
      this.admitNewcomer();
      economy.growth -= grainPerPeasant;
    }
  }

  get hasRoom(): boolean {
    return this.peasantCount < this.tuning.economy.maxPopulation;
  }

  /** Births and admitted travellers both arrive here, so the labor decree places every newcomer. */
  admitNewcomer(): void {
    const newcomer = this.game.delegates.create();
    const { policy } = this.game.labor;
    if (policy === NO_LABOR_POLICY) return;
    // The targets sum to the peasants, which already count this idle newcomer, so a job is short.
    newcomer.job = this.mostShortJob(
      this.laborTargetFor(policy),
      this.game.delegates.jobCounts(),
    ) as WorkingJob;
  }

  laborTargetFor(policy: string): Record<Job, number> {
    const allocations = this.tuning.economy.laborAllocations;
    if (Object.hasOwn(allocations, policy) && allocations[policy]) {
      return this.laborTargets(allocations[policy]);
    }
    const split = LaborSplit.fromPolicy(policy);
    if (!split?.ok) throw new Error(`unknown labor policy "${policy}"`);
    return this.laborTargets(split.split.shares());
  }

  laborTargets(
    shares: Readonly<Record<WorkingJob, number>>,
  ): Record<Job, number> {
    const population = this.peasantCount;
    const targets: Record<Job, number> = {
      farm: 0,
      forest: 0,
      mine: 0,
      idle: 0,
    };
    const remainders: Record<WorkingJob, number> = {
      farm: 0,
      forest: 0,
      mine: 0,
    };
    let assigned = 0;
    for (const job of WORKING_JOBS) {
      const exact = population * shares[job];
      const whole = Math.floor(exact);
      targets[job] = whole;
      remainders[job] = exact - whole;
      assigned += whole;
    }
    for (let left = population - assigned; left > 0; left--) {
      let best: WorkingJob | null = null;
      for (const job of WORKING_JOBS) {
        if (best === null || remainders[job] > remainders[best]) best = job;
      }
      if (best === null) break;
      targets[best] += 1;
      // A job gets at most one leftover peasant.
      remainders[best] = -1;
    }
    return targets;
  }

  private mostShortJob(
    target: Readonly<Record<Job, number>>,
    labor: Readonly<Record<Job, number>>,
  ): WorkingJob | null {
    let short: WorkingJob | null = null;
    let shortBy = 0;
    for (const job of WORKING_JOBS) {
      const gap = target[job] - labor[job];
      if (gap > shortBy) {
        short = job;
        shortBy = gap;
      }
    }
    return short;
  }

  /** Returns whether the split is reached after this tick's moves. */
  moveLaborToward(target: Readonly<Record<Job, number>>): boolean {
    const { tick } = this;
    // Only working jobs are rebalanced: idle peasants are the pool that fills a shortfall, and
    // treating idle as a surplus to drain would stall the move whenever the idle ones hold grudges.
    for (let done = 0; ; done++) {
      const labor = this.game.delegates.jobCounts();
      const short = this.mostShortJob(target, labor);
      if (short === null) return true;
      if (done === this.laborMovesPerTick) return false;
      let mover = this.game.delegates.firstFreeWithJob(Job.IDLE, tick);
      if (mover === undefined) {
        let source: WorkingJob | null = null;
        let excess = 0;
        for (const job of WORKING_JOBS) {
          const over = labor[job] - target[job];
          if (over > excess) {
            source = job;
            excess = over;
          }
        }
        if (source === null) return false;
        mover = this.game.delegates.firstFreeWithJob(source, tick);
      }
      if (mover === undefined) return false;
      mover.job = short;
    }
  }
}
