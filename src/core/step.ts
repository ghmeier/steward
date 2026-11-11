import type { Command, CommandLogEntry, CommandResult } from "./commands";
import type { Game } from "./game";
import type { AbsorbedAdditionLog, AddContext } from "./math";
import { CROWN_PANEL } from "./unlocks";
import { validateState } from "./validate";

export type StepOptions = {
  absorbed: AbsorbedAdditionLog | null;
  /** Validate the state after each step that produces a tick divisible by this; 0 never validates. */
  validateEvery: number;
};

export class InvalidStateError extends Error {}

/** Called after each step with the tick that step produced and the outcome of each command applied in it. */
export type StepObserver = (
  tick: number,
  commands: readonly Command[],
  results: readonly CommandResult[],
) => void;

export class StepManager {
  constructor(private game: Game) {}

  /** The phases that move resources every tick; the ledger projects its rates by running exactly this. */
  runFlows(context: AddContext): void {
    const flows = this.game.economy.run(context);
    this.game.decrees.run(context, flows);
  }

  /** Promotion is never revoked, so a village that later shrinks stays promoted. */
  private checkPromotion(): void {
    const { state, tuning } = this.game;
    if (state.career.promotedAt !== 0) return;
    if (state.posting.delegates.length >= tuning.village.promotionPopulation) {
      state.career.promotedAt = state.tick;
      state.career.unlocks[CROWN_PANEL] = state.tick;
      this.game.crown.scheduleFirstDemand();
    }
  }

  step(commands: readonly Command[], options: StepOptions): CommandResult[] {
    this.game.state.tick += 1;

    const context: AddContext = {
      tick: this.game.state.tick,
      maxValue: this.game.tuning.maxResourceValue,
      absorbed: options.absorbed,
    };
    const results = commands.map((command) =>
      this.game.commands.apply(command, context),
    );
    this.runFlows(context);
    this.game.desk.run(context);
    this.game.crown.run(context);
    this.game.illusion.run();
    this.checkPromotion();
    this.game.unlocks.run();

    if (
      options.validateEvery > 0 &&
      this.game.state.tick % options.validateEvery === 0
    ) {
      this.validate();
    }
    return results;
  }

  validate(): void {
    const problems = validateState(this.game.state);
    if (problems.length > 0) {
      throw new InvalidStateError(
        `state invalid at tick ${this.game.state.tick}: ${problems.join("; ")}`,
      );
    }
  }

  runSteps(
    count: number,
    log: readonly CommandLogEntry[],
    options: StepOptions,
    onStep?: StepObserver,
    commandSource?: () => readonly Command[],
  ): void {
    let cursor = 0;
    // Entries for ticks already produced (resuming from a later state) must not be reapplied.
    while (
      cursor < log.length &&
      (log[cursor]?.tick ?? 0) <= this.game.state.tick
    ) {
      cursor += 1;
    }
    for (let i = 0; i < count; i++) {
      const nextTick = this.game.state.tick + 1;
      const commands: Command[] = commandSource ? [...commandSource()] : [];
      for (
        let entry = log[cursor];
        entry !== undefined && entry.tick === nextTick;
        entry = log[cursor]
      ) {
        commands.push(entry.command);
        cursor += 1;
      }
      const results = this.step(commands, options);
      onStep?.(this.game.state.tick, commands, results);
    }
  }
}
