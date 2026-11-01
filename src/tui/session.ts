import { createClock, DEFAULT_MAX_STEPS_PER_FRAME } from "../clock";
import type { Command, CommandLogEntry } from "../core/commands";
import type { GameState } from "../core/state";
import { step } from "../core/step";
import type { Tuning } from "../core/tuning";
import { computeView, type GameView } from "../core/view";

export type Rejection = { tick: number; command: Command; reason: string };
export type FrameResult = {
  steps: number;
  rejections: Rejection[];
  viewChanged: boolean;
};
export type Session = {
  readonly state: GameState;
  readonly commandLog: readonly CommandLogEntry[];
  enqueue(command: Command): void;
  frame(): FrameResult;
  view(): GameView;
};

export function createSession(options: {
  state: GameState;
  tuning: Tuning;
  now: () => number;
  maxStepsPerFrame?: number;
  validate?: boolean;
}): Session {
  const { state, tuning } = options;
  const clock = createClock({
    stepMs: tuning.stepMs,
    maxStepsPerFrame: options.maxStepsPerFrame ?? DEFAULT_MAX_STEPS_PER_FRAME,
    now: options.now,
  });
  const stepOptions = {
    absorbed: null,
    validate: options.validate ?? false,
  } as const;
  const commandLog: CommandLogEntry[] = [];
  let queued: Command[] = [];
  let currentView = computeView(state, tuning);
  let currentViewJson = JSON.stringify(currentView);

  return {
    state,
    commandLog,
    enqueue(command) {
      queued.push(command);
    },
    frame() {
      const steps = clock.frame();
      const rejections: Rejection[] = [];
      for (let i = 0; i < steps; i++) {
        const commands = queued;
        queued = [];
        const results = step(state, commands, tuning, stepOptions);
        for (const [index, command] of commands.entries()) {
          commandLog.push({ tick: state.tick, command });
          const result = results[index];
          if (result !== undefined && !result.ok) {
            rejections.push({
              tick: state.tick,
              command,
              reason: result.reason,
            });
          }
        }
      }
      if (steps === 0) return { steps, rejections, viewChanged: false };
      currentView = computeView(state, tuning);
      const json = JSON.stringify(currentView);
      const viewChanged = json !== currentViewJson;
      currentViewJson = json;
      return { steps, rejections, viewChanged };
    },
    view() {
      return currentView;
    },
  };
}
