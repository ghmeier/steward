import { CommandManager } from "./commands";
import { ConditionManager } from "./conditions";
import { CrownManager } from "./crown";
import { DecreeEngine } from "./decree-engine";
import { DelegateManager } from "./delegates";
import { DeskManager } from "./desk";
import { EconomyManager } from "./economy";
import { GovernorManager } from "./governors";
import { IllusionManager } from "./illusion";
import { LaborSettling } from "./labor";
import { OfflineManager } from "./offline";
import { defaultVillageName, newPosting } from "./posting";
import { PrestigeManager } from "./prestige";
import { ProjectionManager } from "./projection";
import { SavedDecreeManager } from "./saved-decrees";
import { type GameState, SCHEMA_VERSION } from "./state";
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
  readonly prestige: PrestigeManager;
  readonly commands: CommandManager;
  readonly projection: ProjectionManager;
  readonly offline: OfflineManager;
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
    this.prestige = new PrestigeManager(this);
    this.commands = new CommandManager(this);
    this.projection = new ProjectionManager(this);
    this.offline = new OfflineManager(this);
    this.steps = new StepManager(this);
    this.view = new ViewManager(this);
  }

  /** Starts a new game: seeds every random stream and gathers the initial village. */
  static create(
    seed: number,
    tuning: Tuning,
    name: string = defaultVillageName(seed, tuning),
  ): Game {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
      throw new RangeError(`seed must be a uint32, got ${seed}`);
    }

    const game = new Game(
      {
        schemaVersion: SCHEMA_VERSION,
        tick: 0,
        career: {
          unlocks: {},
          savedDecrees: {},
          seen: {},
          followers: [],
          postings: [],
          promotedAt: 0,
        },
        posting: newPosting(seed, name, tuning, {
          index: 1,
          startedAt: 0,
          resources: tuning.economy.initialResources,
          province: "",
          doctrine: "",
        }),
      },
      tuning,
    );
    game.delegates.createPeasants(tuning.economy.initialPopulation);
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
