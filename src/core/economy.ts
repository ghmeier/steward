import type { ResourcePetition } from "./decree";
import type { Delegate } from "./delegates";
import type { Game } from "./game";
import { NO_LABOR_POLICY } from "./labor";
import { type AddContext, add } from "./math";
import {
  Job,
  SEASONS,
  type Season,
  WORKING_JOBS,
  type WorkingJob,
} from "./realm";

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

  private get population() {
    return this.game.delegates.all.length;
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

  grainSeasons(): number {
    const grain = this.posting.resources.grain ?? 0;
    const upkeepPerSeason =
      this.population * this.grainPerPerson * this.ticksPerSeason;
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
  // Deaths are paced against the starting population so a famine takes at most half the
  // village, spread evenly over one season; integer arithmetic keeps the schedule exact.
  private advanceFamine(): void {
    const famine = this.posting.economy.famine;
    if (famine.ticks === 0) famine.startPopulation = this.population;
    famine.ticks += 1;
    const cap = Math.floor(famine.startPopulation / 2);
    const due = Math.min(
      cap,
      Math.floor((famine.ticks * cap) / this.tuning.economy.ticksPerSeason),
    );
    while (famine.deaths < due && this.population > 0) {
      this.killOnePeasant();
      famine.deaths += 1;
      this.posting.economy.starved += 1;
    }
  }

  run(context: AddContext): EconomyFlows {
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
    if (grain >= upkeep) {
      add(resources, "grain", -upkeep, context);
      economy.famine = { startPopulation: 0, ticks: 0, deaths: 0 };
    } else {
      add(resources, "grain", -grain, context);
      this.advanceFamine();
    }

    return {
      harvest: Math.max(0, produced - upkeep),
      wood: woodCut,
      ore: oreDug,
    };
  }

  sellResource(
    resource: keyof typeof PRICE_KEY,
    amount: number,
    context: AddContext,
  ): void {
    const resources = this.posting.resources;
    add(resources, resource, -amount, context);
    add(
      resources,
      "coin",
      amount * this.tuning.economy[PRICE_KEY[resource]],
      context,
    );
  }

  feedGrain(amount: number, context: AddContext): void {
    const settings = this.tuning.economy;
    const { economy, delegates } = this.posting;
    if (delegates.length >= settings.maxPopulation) return;

    add(this.posting.resources, "grain", -amount, context);
    economy.growth += amount;
    while (
      economy.growth >= settings.grainPerPeasant &&
      delegates.length < settings.maxPopulation
    ) {
      this.admitNewcomer();
      economy.growth -= settings.grainPerPeasant;
    }
  }

  /** Adds one named peasant, placed by the labor decree's policy the same way a birth is. */
  admitNewcomer(): void {
    this.placeNewborn(this.game.delegates.create());
  }

  laborTargetFor(policy: string): Record<Job, number> {
    const allocations = this.tuning.economy.laborAllocations;
    const shares = Object.hasOwn(allocations, policy)
      ? allocations[policy]
      : undefined;
    if (!shares) throw new Error(`unknown labor policy "${policy}"`);
    return this.laborTargets(shares);
  }

  laborTargets(
    shares: Readonly<Record<WorkingJob, number>>,
  ): Record<Job, number> {
    const population = this.population;
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

  private placeNewborn(newborn: Delegate): void {
    const { policy } = this.game.labor;
    if (policy === NO_LABOR_POLICY) return;
    // The targets sum to the population, which already counts this idle newborn, so a job is short.
    newborn.job = this.mostShortJob(
      this.laborTargetFor(policy),
      this.game.delegates.jobCounts(),
    ) as WorkingJob;
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
