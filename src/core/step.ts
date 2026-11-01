import type { Command, CommandLogEntry, CommandResult } from "./commands";
import { runDesk } from "./desk";
import type { AbsorbedAdditionLog, AddContext } from "./math";
import { checkPromotion } from "./promotion";
import type { GameStateManager } from "./state";
import { validateState } from "./validate";

export type StepOptions = {
  absorbed: AbsorbedAdditionLog | null;
  validate: boolean;
};

/** Called after each step with the tick that step produced and the outcome of each command applied in it. */
export type StepObserver = (
  tick: number,
  commands: readonly Command[],
  results: readonly CommandResult[],
) => void;

export class StepManager {
  constructor(private manager: GameStateManager) {}

  /** The phases that move resources every tick; the ledger projects its rates by running exactly this. */
  runFlows(context: AddContext): void {
    const flows = this.manager.em.run(context);
    this.manager.de.run(context, flows);
  }

  step(commands: readonly Command[], options: StepOptions): CommandResult[] {
    this.manager.state.tick += 1;

    const context: AddContext = {
      tick: this.manager.state.tick,
      maxValue: this.manager.tuning.maxResourceValue,
      absorbed: options.absorbed,
    };
    const results = commands.map((command) =>
      this.manager.cmdm.apply(command, context),
    );
    this.runFlows(context);
    runDesk(this.manager.state, this.manager.tuning, context);
    checkPromotion(this.manager.state, this.manager.tuning);
    this.manager.um.run();

    if (options.validate) {
      const problems = validateState(this.manager.state);
      if (problems.length > 0) {
        throw new Error(
          `state invalid at tick ${this.manager.state.tick}: ${problems.join("; ")}`,
        );
      }
    }
    return results;
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
      (log[cursor]?.tick ?? 0) <= this.manager.state.tick
    ) {
      cursor += 1;
    }
    for (let i = 0; i < count; i++) {
      const nextTick = this.manager.state.tick + 1;
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
      onStep?.(this.manager.state.tick, commands, results);
    }
  }
}
