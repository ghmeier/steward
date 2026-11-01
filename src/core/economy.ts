import type { ResourcePetition } from "./decree";
import { type AddContext, add } from "./math";
import { JOBS, Job, SEASONS, type Season } from "./realm";
import type { GameStateManager } from "./state";

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
  constructor(private manager: GameStateManager) {}

  private get ticksPerSeason() {
    return this.manager.tuning.economy.ticksPerSeason;
  }

  private get grainPerPerson() {
    return this.manager.tuning.economy.grainPerPerson;
  }

  private get grainPerFarmer() {
    return this.manager.tuning.economy.grainPerFarmer;
  }

  private get seasonYield() {
    return this.manager.tuning.economy.seasonYield;
  }

  seasonAt(tick: number): Season {
    if (tick < 1) return "spring";
    const index = Math.floor((tick - 1) / this.ticksPerSeason) % SEASONS.length;
    return SEASONS[index] ?? "spring";
  }

  grainSeasons(): number {
    const grain = this.manager.state.posting.resources.grain ?? 0;
    const upkeepPerSeason =
      this.manager.state.posting.delegates.length *
      this.grainPerPerson *
      this.ticksPerSeason;
    if (upkeepPerSeason === 0)
      return grain === 0 ? 0 : this.manager.tuning.maxResourceValue;
    return grain / upkeepPerSeason;
  }

  private grainProduced(): number {
    const season = this.seasonAt(this.manager.state.tick);
    return (
      this.manager.dm.workingCountsAt(this.manager.state.tick).farm *
      this.grainPerFarmer *
      this.seasonYield[season]
    );
  }

  private upkeepOf(): number {
    return this.manager.state.posting.delegates.length * this.grainPerPerson;
  }

  // Idle peasants die first so that a starving village loses its workers last; among
  // workers the order is fixed (mine, forest, farm) so replay never depends on state shape.
  private killOnePeasant(): void {
    const victim =
      this.manager.dm.firstWithJob(Job.IDLE) ??
      this.manager.dm.firstWithJob(Job.MINE) ??
      this.manager.dm.firstWithJob(Job.FOREST) ??
      this.manager.dm.firstWithJob(Job.FARM);
    if (victim !== undefined) this.manager.dm.remove(victim.id);
  }
  // Deaths are paced against the starting population so a famine takes at most half the
  // village, spread evenly over one season; integer arithmetic keeps the schedule exact.
  private advanceFamine(): void {
    const famine = this.manager.state.posting.economy.famine;
    if (famine.ticks === 0)
      famine.startPopulation = this.manager.state.posting.delegates.length;
    famine.ticks += 1;
    const cap = Math.floor(famine.startPopulation / 2);
    const due = Math.min(
      cap,
      Math.floor(
        (famine.ticks * cap) / this.manager.tuning.economy.ticksPerSeason,
      ),
    );
    while (
      famine.deaths < due &&
      this.manager.state.posting.delegates.length > 0
    ) {
      this.killOnePeasant();
      famine.deaths += 1;
      this.manager.state.posting.economy.starved += 1;
    }
  }

  run(context: AddContext): EconomyFlows {
    const settings = this.manager.tuning.economy;
    const resources = this.manager.state.posting.resources;
    const { economy } = this.manager.state.posting;
    const working = this.manager.dm.workingCountsAt(this.manager.state.tick);

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
    const resources = this.manager.state.posting.resources;
    add(resources, resource, -amount, context);
    add(
      resources,
      "coin",
      amount * this.manager.tuning.economy[PRICE_KEY[resource]],
      context,
    );
  }

  feedGrain(amount: number, context: AddContext): void {
    const settings = this.manager.tuning.economy;
    const { economy, delegates } = this.manager.state.posting;
    if (delegates.length >= settings.maxPopulation) return;

    add(this.manager.state.posting.resources, "grain", -amount, context);
    economy.growth += amount;
    while (
      economy.growth >= settings.grainPerPeasant &&
      delegates.length < settings.maxPopulation
    ) {
      this.manager.dm.create();
      economy.growth -= settings.grainPerPeasant;
    }
  }

  laborTargets(
    population: number,
    shares: Readonly<Record<Job, number>>,
  ): Record<Job, number> {
    const targets: Record<Job, number> = {
      farm: 0,
      forest: 0,
      mine: 0,
      idle: 0,
    };
    const remainders: Record<Job, number> = {
      farm: 0,
      forest: 0,
      mine: 0,
      idle: 0,
    };
    let assigned = 0;
    for (const job of JOBS) {
      const exact = population * shares[job];
      const whole = Math.floor(exact);
      targets[job] = whole;
      remainders[job] = exact - whole;
      assigned += whole;
    }
    for (let left = population - assigned; left > 0; left--) {
      let best: Job | null = null;
      for (const job of JOBS) {
        if (best === null || remainders[job] > remainders[best]) best = job;
      }
      if (best === null) break;
      targets[best] += 1;
      // A job gets at most one leftover peasant.
      remainders[best] = -1;
    }
    return targets;
  }

  moveLaborToward(
    target: Readonly<Record<Job, number>>,
    moves: number,
    tick: number,
  ): void {
    for (let done = 0; done < moves; done++) {
      const labor = this.manager.dm.jobCounts();
      let short: Job | null = null;
      let shortBy = 0;
      for (const job of JOBS) {
        const gap = target[job] - labor[job];
        if (gap > shortBy) {
          short = job;
          shortBy = gap;
        }
      }
      if (short === null) return;
      let mover = this.manager.dm.firstFreeWithJob(Job.IDLE, tick);
      if (mover === undefined) {
        let source: Job | null = null;
        let excess = 0;
        for (const job of JOBS) {
          const over = labor[job] - target[job];
          if (over > excess) {
            source = job;
            excess = over;
          }
        }
        if (source === null) return;
        mover = this.manager.dm.firstFreeWithJob(source, tick);
      }
      if (mover === undefined) return;
      mover.job = short;
    }
  }
}
