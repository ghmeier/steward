import {
  apply,
  type Command,
  type CommandLogEntry,
  type CommandResult,
} from "./commands";
import { runDecrees } from "./decree-engine";
import { runDesk } from "./desk";
import { runEconomy } from "./economy";
import type { AbsorbedAdditionLog, AddContext } from "./math";
import { checkPromotion } from "./promotion";
import type { GameState } from "./state";
import type { Tuning } from "./tuning";
import { runUnlocks } from "./unlocks";
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

/** The phases that move resources every tick; the ledger projects its rates by running exactly this. */
export function runFlows(
  state: GameState,
  tuning: Tuning,
  context: AddContext,
): void {
  const flows = runEconomy(state, tuning, context);
  runDecrees(state, tuning, context, flows);
}

export function step(
  state: GameState,
  commands: readonly Command[],
  tuning: Tuning,
  options: StepOptions,
): CommandResult[] {
  state.tick += 1;

  const context: AddContext = {
    tick: state.tick,
    maxValue: tuning.maxResourceValue,
    absorbed: options.absorbed,
  };
  const results = commands.map((command) =>
    apply(state, command, tuning, context),
  );
  runFlows(state, tuning, context);
  runDesk(state, tuning, context);
  checkPromotion(state, tuning);
  runUnlocks(state, tuning);

  if (options.validate) {
    const problems = validateState(state);
    if (problems.length > 0) {
      throw new Error(
        `state invalid at tick ${state.tick}: ${problems.join("; ")}`,
      );
    }
  }
  return results;
}

export function runSteps(
  state: GameState,
  count: number,
  tuning: Tuning,
  log: readonly CommandLogEntry[],
  options: StepOptions,
  onStep?: StepObserver,
  commandSource?: () => readonly Command[],
): void {
  let cursor = 0;
  // Entries for ticks already produced (resuming from a later state) must not be reapplied.
  while (cursor < log.length && (log[cursor]?.tick ?? 0) <= state.tick) {
    cursor += 1;
  }
  for (let i = 0; i < count; i++) {
    const nextTick = state.tick + 1;
    const commands: Command[] = commandSource ? [...commandSource()] : [];
    for (
      let entry = log[cursor];
      entry !== undefined && entry.tick === nextTick;
      entry = log[cursor]
    ) {
      commands.push(entry.command);
      cursor += 1;
    }
    const results = step(state, commands, tuning, options);
    onStep?.(state.tick, commands, results);
  }
}
