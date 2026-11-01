import { CommandManager } from "./commands";
import { ConditionManager } from "./conditions";
import { DecreeEngine } from "./decree-engine";
import { DelegateManager } from "./delegates";
import { DeskManager, drawArrivalDelay } from "./desk";
import { EconomyManager } from "./economy";
import { ProjectionManager } from "./projection";
import { RESOURCES } from "./realm";
import { type RngState, seedStream } from "./rng";
import { SavedDecreeManager } from "./saved-decrees";
import {
  type GameState,
  type PostingState,
  type ResourceId,
  RNG_STREAMS,
  SCHEMA_VERSION,
} from "./state";
import { StepManager } from "./step";
import type { Tuning } from "./tuning";
import { UnlockManager } from "./unlocks";
import { assertValidState } from "./validate";
import { ViewManager } from "./view";

export class Game {
  readonly delegates: DelegateManager;
  readonly economy: EconomyManager;
  readonly conditions: ConditionManager;
  readonly decrees: DecreeEngine;
  readonly savedDecrees: SavedDecreeManager;
  readonly unlocks: UnlockManager;
  readonly desk: DeskManager;
  readonly commands: CommandManager;
  readonly projection: ProjectionManager;
  readonly steps: StepManager;
  readonly view: ViewManager;

  private constructor(
    public state: GameState,
    readonly tuning: Tuning,
  ) {
    this.delegates = new DelegateManager(this);
    this.economy = new EconomyManager(this);
    this.conditions = new ConditionManager(this);
    this.decrees = new DecreeEngine(this);
    this.savedDecrees = new SavedDecreeManager(this);
    this.unlocks = new UnlockManager(this);
    this.desk = new DeskManager(this);
    this.commands = new CommandManager(this);
    this.projection = new ProjectionManager(this);
    this.steps = new StepManager(this);
    this.view = new ViewManager(this);
  }

  /** Starts a new game: seeds every random stream and gathers the initial village. */
  static create(seed: number, tuning: Tuning): Game {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
      throw new RangeError(`seed must be a uint32, got ${seed}`);
    }

    const rng: Record<string, RngState> = {};
    const resources: Record<ResourceId, number> = {};
    for (const resource of RESOURCES) {
      resources[resource] = tuning.economy.initialResources[resource];
    }
    for (const name of RNG_STREAMS) {
      rng[name] = seedStream(seed, name);
    }
    const arrivals = rng.disputes;
    if (arrivals === undefined)
      throw new Error("the disputes stream is missing");
    const posting: PostingState = {
      postingId: "posting-1",
      seed,
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
      desk: {
        nextDisputeId: 1,
        nextArrivalTick: drawArrivalDelay(arrivals, tuning),
        disputes: [],
      },
    };
    const game = new Game(
      {
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
      },
      tuning,
    );
    for (let i = 0; i < tuning.economy.initialPopulation; i++) {
      game.delegates.create();
    }
    return game;
  }

  /** Wraps existing state, such as a loaded save or a copy; it draws nothing from the random streams. */
  static fromState(state: GameState, tuning: Tuning): Game {
    return new Game(state, tuning);
  }

  clone(): Game {
    return Game.fromState(structuredClone(this.state), this.tuning);
  }

  validate(): void {
    assertValidState(this.state);
  }
}
