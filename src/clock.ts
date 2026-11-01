export const DEFAULT_MAX_STEPS_PER_FRAME = 50;

// Sums of fractional frame times (for example 16.667 ms) land a hair below an exact multiple of
// stepMs, which would delay a step by a whole frame. A nanosecond-scale tolerance absorbs that error.
const FLOAT_TOLERANCE_MS = 1e-6;

export type ClockAccumulator = {
  stepMs: number;
  maxStepsPerFrame: number;
  carriedMs: number;
  droppedMs: number;
};

export function createAccumulator(
  stepMs: number,
  maxStepsPerFrame: number,
): ClockAccumulator {
  if (!Number.isFinite(stepMs) || stepMs <= 0) {
    throw new RangeError(
      `stepMs must be a positive finite number, got ${stepMs}`,
    );
  }
  if (!Number.isInteger(maxStepsPerFrame) || maxStepsPerFrame <= 0) {
    throw new RangeError(
      `maxStepsPerFrame must be a positive integer, got ${maxStepsPerFrame}`,
    );
  }
  return { stepMs, maxStepsPerFrame, carriedMs: 0, droppedMs: 0 };
}

export function advance(
  accumulator: ClockAccumulator,
  elapsedMs: number,
): number {
  // Clocks can jump backward (or produce NaN), and that must never refund or remove steps.
  const safeElapsedMs =
    elapsedMs > 0 && Number.isFinite(elapsedMs) ? elapsedMs : 0;
  const totalMs = accumulator.carriedMs + safeElapsedMs;
  const wholeSteps = Math.floor(
    (totalMs + FLOAT_TOLERANCE_MS) / accumulator.stepMs,
  );
  const remainderMs = Math.max(0, totalMs - wholeSteps * accumulator.stepMs);

  // Without the cap, a machine that sleeps with the game open wakes up and tries to run hours of
  // steps in one frame. The excess is dropped rather than carried, and recorded in droppedMs because
  // it is the second way time passes unseen: phase 10's offline catch-up will consume droppedMs
  // instead of discarding it.
  const steps = Math.min(wholeSteps, accumulator.maxStepsPerFrame);
  accumulator.droppedMs += (wholeSteps - steps) * accumulator.stepMs;
  accumulator.carriedMs = remainderMs;
  return steps;
}

export function createClock(options: {
  stepMs: number;
  maxStepsPerFrame: number;
  now?: () => number;
}): { frame(): number; accumulator: ClockAccumulator } {
  const now = options.now ?? (() => performance.now());
  const accumulator = createAccumulator(
    options.stepMs,
    options.maxStepsPerFrame,
  );
  let previousMs: number | undefined;

  return {
    accumulator,
    frame(): number {
      const currentMs = now();
      if (previousMs === undefined) {
        previousMs = currentMs;
        return 0;
      }
      const elapsedMs = currentMs - previousMs;
      previousMs = currentMs;
      return advance(accumulator, elapsedMs);
    },
  };
}
