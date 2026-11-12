import { afterEach } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { Job } from "../src/core/realm";
import type { GameView } from "../src/core/view";
import type { FocusId, KeyPress } from "../src/tui/keys";
import { createPanels } from "../src/tui/panels";
import { Village } from "../src/tui/village-panels";
import { tuning } from "./helpers";

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
const drawn: TestSetup[] = [];

/** Registers a hook that disposes every renderer the panel helpers opened, so a test file calls it once at the top. */
export function disposeDrawnPanels(): void {
  afterEach(async () => {
    for (const setup of drawn.splice(0)) await setup.dispose();
  });
}

/** Opens a renderer that the registered hook disposes after the test. */
export async function openRenderer(
  width: number,
  height: number,
): Promise<TestSetup> {
  const setup = await createTestRenderer({ width, height, exitOnCtrlC: false });
  drawn.push(setup);
  return setup;
}

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

type DrawOptions = {
  size?: { width: number; height: number };
  focus?: FocusId | null;
  /** Index of the selected peasant in the roster; only shown while Peasants is focused. */
  selectedIndex?: number;
};

export async function drawPanels(
  views: GameView[],
  {
    size = { width: 100, height: 30 },
    focus = null,
    selectedIndex = 0,
  }: DrawOptions = {},
) {
  const setup = await openRenderer(size.width, size.height);
  const village = new Village();
  const panels = createPanels(setup.renderer, village);
  let frame = "";
  for (const view of views) {
    const context = { view, tuning };
    village.peasants.reset(view);
    if (focus !== null) village.focusable[focus].enter(context);
    for (let step = 0; step < selectedIndex; step++) {
      village.peasants.key(key("j"), context);
    }
    panels.update({ context, message: null, focus });
    frame = await settledFrame(setup);
  }
  return frame;
}

export const escaped = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Matches a line produced by a template that takes one count, whatever the count is. */
export function countedLine(
  template: (args: { count: string }) => string,
): RegExp {
  const [before = "", after = ""] = template({ count: "\u0000" }).split(
    "\u0000",
  );
  return new RegExp(`${escaped(before)}\\d+${escaped(after)}`);
}

export function emptyView(overrides: Partial<GameView> = {}): GameView {
  return {
    tick: 0,
    elapsedSeconds: 0,
    ledger: [],
    realm: {
      population: 10,
      labor: { farm: 0, forest: 0, mine: 0, idle: 10 },
      season: "spring",
      starved: 0,
    },
    delegates: [],
    decrees: [],
    savedDecrees: [],
    desk: [],
    governors: [],
    formerGovernors: [],
    crown: null,
    illusion: null,
    villageName: "Ashford",
    title: "Reeve",
    promotion: { target: 20, promotedAt: 0, promotedAtSeconds: 0 },
    growth: { stored: 0, needed: 25, perSecond: 0, full: false },
    grainEatenPerSecond: 0,
    lockedPanels: [],
    unlocks: [],
    archive: { open: false, entries: [] },
    ...overrides,
  };
}

export const ada = { id: 3, name: "Ada", job: Job.FARM, grudgeTicks: 0 };
export const dispute = {
  id: 1,
  kind: "dispute" as const,
  label: "A squabble",
  parties: ["Ada", "Bram"] as [string, string],
  ticksLeft: null,
  options: [],
};
export const growth = (changes: Partial<GameView["growth"]>) => ({
  stored: 12.4,
  needed: 25,
  perSecond: 0.5,
  full: false,
  ...changes,
});
export const realmOf = (changes: Partial<GameView["realm"]>) => ({
  ...emptyView().realm,
  ...changes,
});
