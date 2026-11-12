import { CommandManager } from "./commands";
import { ConditionManager } from "./conditions";
import { CrownManager, emptyCrownState } from "./crown";
import { DecreeEngine } from "./decree-engine";
import { DelegateManager } from "./delegates";
import { DeskManager, initialDeskState } from "./desk";
import { EconomyManager, emptyEconomyState } from "./economy";
import { GovernorManager } from "./governors";
import { emptyIllusionState, IllusionManager } from "./illusion";
import { emptyLaborState, LaborSettling } from "./labor";
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
  readonly labor: LaborSettling;
  readonly savedDecrees: SavedDecreeManager;
  readonly unlocks: UnlockManager;
  readonly desk: DeskManager;
  readonly governors: GovernorManager;
  readonly crown: CrownManager;
  readonly illusion: IllusionManager;
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
    this.labor = new LaborSettling(this);
    this.savedDecrees = new SavedDecreeManager(this);
    this.unlocks = new UnlockManager(this);
    this.desk = new DeskManager(this);
    this.governors = new GovernorManager(this);
    this.crown = new CrownManager(this);
    this.illusion = new IllusionManager(this);
    this.commands = new CommandManager(this);
    this.projection = new ProjectionManager(this);
    this.steps = new StepManager(this);
    this.view = new ViewManager(this);
  }

  /** Picks from the seed rather than a random stream, so the same seed always founds the same village name. */
  static defaultVillageName(seed: number, tuning: Tuning): string {
    const { villageNames } = tuning.village;
    return villageNames[seed % villageNames.length] as string;
  }

  /** Starts a new game: seeds every random stream and gathers the initial village. */
  static create(
    seed: number,
    tuning: Tuning,
    name: string = Game.defaultVillageName(seed, tuning),
  ): Game {
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
      name,
      seed,
      rng,
      resources,
      economy: emptyEconomyState(),
      delegates: [],
      nextDelegateId: 1,
      formerStaff: [],
      decrees: {},
      labor: emptyLaborState(),
      desk: initialDeskState(arrivals, tuning.desk),
      crown: emptyCrownState(),
      illusion: emptyIllusionState(),
    };
    const game = new Game(
      {
        schemaVersion: SCHEMA_VERSION,
        tick: 0,
        career: {
          unlocks: {},
          savedDecrees: {},
          seen: {},
          followers: [],
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
