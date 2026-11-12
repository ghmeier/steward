import { createClock, DEFAULT_MAX_STEPS_PER_FRAME } from "../clock";
import type { Command, CommandLogEntry } from "../core/commands";
import type { Game } from "../core/game";
import type { GameView } from "../core/view";

export type Rejection = { tick: number; command: Command; reason: string };
export type FrameResult = {
  steps: number;
  rejections: Rejection[];
  /** What commands that worked reported back, in order. */
  messages: string[];
  /** The flavor lines of desk entries that expired, in the order they expired. */
  expired: string[];
  viewChanged: boolean;
};

export class Session {
  readonly commandLog: CommandLogEntry[] = [];
  private readonly clock: ReturnType<typeof createClock>;
  private readonly stepOptions: { absorbed: null; validateEvery: number };
  private queued: Command[] = [];
  private currentView: GameView;
  private currentViewJson: string;

  constructor(
    readonly game: Game,
    options: {
      now: () => number;
      maxStepsPerFrame?: number;
      validateEvery?: number;
    },
  ) {
    this.clock = createClock({
      stepMs: game.tuning.stepMs,
      maxStepsPerFrame: options.maxStepsPerFrame ?? DEFAULT_MAX_STEPS_PER_FRAME,
      now: options.now,
    });
    this.stepOptions = {
      absorbed: null,
      validateEvery: options.validateEvery ?? 0,
    };
    this.currentView = game.view.compute();
    this.currentViewJson = JSON.stringify(this.currentView);
  }

  enqueue(command: Command): void {
    this.queued.push(command);
  }

  frame(): FrameResult {
    const steps = this.clock.frame();
    const rejections: Rejection[] = [];
    const messages: string[] = [];
    const expired: string[] = [];
    for (let i = 0; i < steps; i++) {
      const commands = this.queued;
      this.queued = [];
      const results = this.game.steps.step(commands, this.stepOptions);
      const { tick } = this.game.state;
      for (const [index, command] of commands.entries()) {
        this.commandLog.push({ tick, command });
        const result = results[index];
        if (result === undefined) continue;
        if (!result.ok) {
          rejections.push({ tick, command, reason: result.reason });
        } else if (result.message !== undefined) {
          messages.push(result.message);
        }
      }
      expired.push(...this.game.desk.expired);
    }
    if (steps === 0)
      return { steps, rejections, messages, expired, viewChanged: false };
    this.currentView = this.game.view.compute();
    const json = JSON.stringify(this.currentView);
    const viewChanged = json !== this.currentViewJson;
    this.currentViewJson = json;
    return { steps, rejections, messages, expired, viewChanged };
  }

  view(): GameView {
    return this.currentView;
  }
}
