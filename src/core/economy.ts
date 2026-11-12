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
    grainPrice: nonNegative,
    woodPrice: nonNegative,
    orePrice: nonNegative,
    grainPerPeasant: positive,
    maxPopulation: positiveInteger,
    laborMovesPerTick: positiveInteger,
    initialPopulation: z.int().min(0),
    initialResources: z.record(z.enum(RESOURCES), nonNegative),
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

  private get grainPerFarmer() {
    return this.tuning.economy.grainPerFarmer;
  }

  private get seasonYield() {
    return this.tuning.economy.seasonYield;
  }

  seasonAt(tick: number): Season {
    if (tick < 1) return "spring";
    const index = Math.floor((tick - 1) / this.ticksPerSeason) % SEASONS.length;
    return SEASONS[index] ?? "spring";
  }

  /** Grain the whole village eats in one season at the current population. */
  grainUpkeepPerSeason(): number {
    return this.population * this.grainPerPerson * this.ticksPerSeason;
  }

  grainSeasons(): number {
    const grain = this.posting.resources.grain ?? 0;
    const upkeepPerSeason = this.grainUpkeepPerSeason();
    if (upkeepPerSeason === 0)
      return grain === 0 ? 0 : this.tuning.maxResourceValue;
    return grain / upkeepPerSeason;
  }

  private grainProduced(): number {
    const season = this.seasonAt(this.tick);
    return (
      this.game.delegates.workingCountsAt(this.tick).farm *
      this.grainPerFarmer *
      this.seasonYield[season]
    );
  }

  /** What one worker on the job yields in a tick at the given tick; null for idle. */
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
        return { resource: "wood", amount: this.tuning.economy.woodPerWorker };
      case Job.MINE:
        return { resource: "ore", amount: this.tuning.economy.orePerWorker };
      case Job.IDLE:
        return null;
    }
  }

  private upkeepOf(): number {
    return this.population * this.grainPerPerson;
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
    const settings = this.tuning.economy;
    const resources = this.posting.resources;
    const { economy } = this.posting;
    const working = this.game.delegates.workingCountsAt(this.tick);

    const produced = this.grainProduced();
    add(resources, "grain", produced, context);
    const woodCut = working.forest * settings.woodPerWorker;
    const oreDug = working.mine * settings.orePerWorker;
    add(resources, "wood", woodCut, context);
    add(resources, "ore", oreDug, context);

    const upkeep = this.upkeepOf();
    const grain = resources.grain ?? 0;
    const eaten = Math.min(grain, upkeep);
    if (grain >= upkeep) {
      add(resources, "grain", -upkeep, context);
      economy.famine = { startPopulation: 0, ticks: 0, deaths: 0 };
    } else {
      add(resources, "grain", -grain, context);
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
    return resource === "coin" ? 1 : this.tuning.economy[PRICE_KEY[resource]];
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
