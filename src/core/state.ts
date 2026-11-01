import { CommandManager } from "./commands";
import { ConditionManager } from "./conditions";
import type { Decree } from "./decree";
import { DecreeEngine } from "./decree-engine";
import { type Delegate, DelegateManager } from "./delegates";
import { type DeskState, drawArrivalDelay } from "./desk";
import { EconomyManager, type EconomyState } from "./economy";
import { ProjectionManager } from "./projection";
import { RESOURCES } from "./realm";
import { type RngState, seedStream } from "./rng";
import { SavedDecreeManager } from "./saved-decrees";
import { StepManager } from "./step";
import type { Tuning } from "./tuning";
import { UnlockManager } from "./unlocks";

export const SCHEMA_VERSION = 8;

export type ResourceId = string;

export type CareerState = {
  unlocks: Record<string, number>;
  savedDecrees: Record<string, Decree>;
  /** The first tick each control was needed, keyed by control; the tutorial reads it. */
  needed: Record<string, number>;
  followers: string[];
  formerStaff: string[];
  /** 0 until promotion; a promotion can only happen at tick 1 or later. */
  promotedAt: number;
};

export type PostingState = {
  postingId: string;
  seed: number;
  rng: Record<string, RngState>;
  resources: Record<ResourceId, number>;
  economy: EconomyState;
  delegates: Delegate[];
  nextDelegateId: number;
  decrees: Record<string, Decree>;
  desk: DeskState;
};

export type GameState = {
  schemaVersion: number;
  tick: number;
  career: CareerState;
  posting: PostingState;
};

/** Every stream the systems draw from; each is seeded at creation so no system seeds lazily mid-run. */
export const RNG_STREAMS = ["disputes", "names"] as const;

export class GameStateManager {
  public state: GameState;
  public dm: DelegateManager;
  public cm: ConditionManager;
  public cmdm: CommandManager;
  public um: UnlockManager;
  public de: DecreeEngine;
  public em: EconomyManager;
  public sdm: SavedDecreeManager;
  public pm: ProjectionManager;
  public sm: StepManager;
  public tuning: Tuning;
  private seed: number;

  constructor(seed: number, tuning: Tuning) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
      throw new RangeError(`seed must be a uint32, got ${seed}`);
    }

    this.tuning = tuning;
    this.seed = seed;

    const rng: Record<string, RngState> = {};
    const resources: Record<ResourceId, number> = {};
    for (const resource of RESOURCES) {
      resources[resource] = this.tuning.economy.initialResources[resource];
    }
    for (const name of RNG_STREAMS) {
      rng[name] = seedStream(this.seed, name);
    }
    const posting: PostingState = {
      postingId: "posting-1",
      seed: this.seed,
      rng,
      resources,
      economy: {
        famine: { startPopulation: 0, ticks: 0, deaths: 0 },
        growth: 0,
        starved: 0,
      },
      delegates: [],
      nextDelegateId: 1,
      decrees: {},
      desk: { nextDisputeId: 1, nextArrivalTick: 0, disputes: [] },
    };
    const arrivals = rng.disputes;
    if (arrivals === undefined)
      throw new Error("the disputes stream is missing");
    posting.desk.nextArrivalTick = drawArrivalDelay(arrivals, tuning);
    this.state = {
      schemaVersion: SCHEMA_VERSION,
      tick: 0,
      career: {
        unlocks: {},
        savedDecrees: {},
        needed: {},
        followers: [],
        formerStaff: [],
        promotedAt: 0,
      },
      posting,
    };

    this.dm = new DelegateManager(this);
    this.cm = new ConditionManager(this);
    this.um = new UnlockManager(this);
    this.de = new DecreeEngine(this);
    this.em = new EconomyManager(this);
    this.sdm = new SavedDecreeManager(this);
    this.cmdm = new CommandManager(this);
    this.pm = new ProjectionManager(this);
    this.sm = new StepManager(this);

    for (let i = 0; i < this.tuning.economy.initialPopulation; i++) {
      this.dm.create();
    }
  }

  clone() {
    const manager = new GameStateManager(this.seed, this.tuning);
    manager.state = structuredClone(this.state);
    return manager;
  }
}
