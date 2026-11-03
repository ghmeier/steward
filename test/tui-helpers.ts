import type { createTestRenderer } from "@opentui/core/testing";
import type { KeyPress } from "../src/tui/keys";

export function key(name: string, modifiers: Partial<KeyPress> = {}): KeyPress {
  return {
    name,
    ctrl: false,
    meta: false,
    shift: false,
    sequence: name,
    ...modifiers,
  };
}

type TestSetup = Awaited<ReturnType<typeof createTestRenderer>>;

/** Panels learn their real size during the first paint and redraw right after it, so a settled frame takes two passes. */
export async function settledFrame(setup: TestSetup): Promise<string> {
  await setup.renderOnce();
  await new Promise((resolve) => process.nextTick(resolve));
  await setup.renderOnce();
  return setup.captureCharFrame();
}

/** The captured frame ends with a newline, so the bar is the second-to-last row. */
export function barRow(frame: string): string {
  return frame.split("\n").at(-2) ?? "";
}
