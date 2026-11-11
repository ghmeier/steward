import { copy } from "../core/copy";
import { Job } from "../core/realm";
import {
  ARCHIVE_PANEL,
  CONJURING,
  CROWN_PANEL,
  PALETTE_UNLOCK,
  type UnlockId,
} from "../core/unlocks";

export type KeyPress = {
  name: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  /** The text the terminal sent for this key, which is what a text field appends. */
  sequence: string;
};
export const FOCUS_IDS = [
  "ledger",
  "peasants",
  "archive",
  "court",
  "decrees",
  "crown",
] as const;
export type FocusId = (typeof FOCUS_IDS)[number];

/** What a global key asks for; the focused panel owns every other key, including peasant assignment. */
export type KeyAction =
  | { kind: "focus"; panel: FocusId }
  | { kind: "cycle"; delta: -1 | 1 }
  | { kind: "save" }
  | { kind: "line"; prefill: string }
  | { kind: "help" }
  | { kind: "newGame" }
  | { kind: "quit" };

/** What a key asks of the peasants panel; the panel turns an assignment into a command for the selected peasant. */
export type PeasantAction =
  | { kind: "move"; delta: -1 | 1 }
  | { kind: "assign"; job: Job };

type FocusChange = Extract<KeyAction, { kind: "focus" | "cycle" }>;

type Binding = { action: KeyAction; needs?: UnlockId };

const BINDINGS: Readonly<Record<string, Binding>> = {
  l: { action: { kind: "focus", panel: "ledger" }, needs: CONJURING },
  p: { action: { kind: "focus", panel: "peasants" } },
  a: { action: { kind: "focus", panel: "archive" }, needs: ARCHIVE_PANEL },
  c: { action: { kind: "focus", panel: "court" } },
  d: { action: { kind: "focus", panel: "decrees" } },
  r: { action: { kind: "focus", panel: "crown" }, needs: CROWN_PANEL },
  left: { action: { kind: "cycle", delta: -1 } },
  right: { action: { kind: "cycle", delta: 1 } },
  ":": { action: { kind: "line", prefill: "" }, needs: PALETTE_UNLOCK },
  "?": { action: { kind: "help" } },
  n: { action: { kind: "newGame" } },
  s: { action: { kind: "save" } },
  q: { action: { kind: "quit" } },
};

/** The focusable panels in reading order, limited to the ones the player owns, as the arrow keys step through them. */
export class FocusRing {
  constructor(private readonly unlocks: readonly string[]) {}

  private static neededBy(panel: FocusId): UnlockId | undefined {
    return Object.values(BINDINGS).find(
      ({ action }) => action.kind === "focus" && action.panel === panel,
    )?.needs;
  }

  private get panels(): FocusId[] {
    return FOCUS_IDS.filter((panel) => {
      const needs = FocusRing.neededBy(panel);
      return needs === undefined || this.unlocks.includes(needs);
    });
  }

  target(action: FocusChange, from: FocusId | null): FocusId {
    return action.kind === "focus"
      ? action.panel
      : this.step(from, action.delta);
  }

  /** With nothing focused, forward lands on the first panel and backward on the last. */
  private step(from: FocusId | null, delta: -1 | 1): FocusId {
    const { panels } = this;
    const at =
      from === null ? (delta === 1 ? -1 : panels.length) : panels.indexOf(from);
    return panels[(at + delta + panels.length) % panels.length] as FocusId;
  }
}

const PEASANT_BINDINGS: Readonly<Record<string, PeasantAction>> = {
  up: { kind: "move", delta: -1 },
  k: { kind: "move", delta: -1 },
  down: { kind: "move", delta: 1 },
  j: { kind: "move", delta: 1 },
  f: { kind: "assign", job: Job.FARM },
  w: { kind: "assign", job: Job.FOREST },
  m: { kind: "assign", job: Job.MINE },
  i: { kind: "assign", job: Job.IDLE },
};

/** The key bound to focus a panel, so prose and notices name the letter the bindings actually use. */
export function keyFor(panel: FocusId): string {
  const bound = Object.entries(BINDINGS).find(
    ([, { action }]) => action.kind === "focus" && action.panel === panel,
  );
  if (bound === undefined) throw new Error(`no key focuses ${panel}`);
  return bound[0];
}

/** The key that gives a peasant a job while the Peasants panel is focused. */
export function peasantKeyFor(job: Job): string {
  const bound = Object.entries(PEASANT_BINDINGS).find(
    ([, action]) => action.kind === "assign" && action.job === job,
  );
  if (bound === undefined) throw new Error(`no key assigns ${job}`);
  return bound[0];
}

export function isInterrupt(key: KeyPress): boolean {
  return key.ctrl && !key.meta && key.name === "c";
}

/** Null for a key held with Ctrl or Meta, which no binding uses. */
export function plainKeyName(key: KeyPress): string | null {
  if (key.ctrl || key.meta) return null;
  // Kitty-protocol terminals report ? as shift plus the slash key and : as shift plus the semicolon key.
  if (key.name === "/" && key.shift) return "?";
  if (key.name === ";" && key.shift) return ":";
  return key.name;
}

export function actionForKey(
  key: KeyPress,
  unlocks: readonly string[],
): KeyAction | null {
  // In raw mode Ctrl-C arrives as a keypress, not SIGINT.
  if (isInterrupt(key)) return { kind: "quit" };
  const name = plainKeyName(key);
  if (name === null) return null;
  const binding = Object.hasOwn(BINDINGS, name) ? BINDINGS[name] : undefined;
  if (binding === undefined) return null;
  if (binding.needs !== undefined && !unlocks.includes(binding.needs)) {
    return null;
  }
  // A copy keeps callers (and the command log) from sharing and mutating table entries.
  return structuredClone(binding.action);
}

export function peasantActionForKey(key: KeyPress): PeasantAction | null {
  const name = plainKeyName(key);
  if (name === null) return null;
  const action = Object.hasOwn(PEASANT_BINDINGS, name)
    ? PEASANT_BINDINGS[name]
    : undefined;
  return action === undefined ? null : structuredClone(action);
}

type ShownHint = { keys: string; label: string };
type KeyHint = ShownHint & { needs?: UnlockId };

const GLOBAL_HINTS: readonly KeyHint[] = [
  { keys: "l", label: copy.keys.hints.ledger, needs: CONJURING },
  { keys: "p", label: copy.keys.hints.peasants },
  { keys: "a", label: copy.keys.hints.archive, needs: ARCHIVE_PANEL },
  { keys: "c", label: copy.keys.hints.court },
  { keys: "d", label: copy.keys.hints.decrees },
  { keys: "r", label: copy.keys.hints.crown, needs: CROWN_PANEL },
  { keys: ":", label: copy.keys.hints.commands, needs: PALETTE_UNLOCK },
  { keys: "s", label: copy.keys.hints.save },
  { keys: "n", label: copy.keys.hints.newVillage },
  { keys: "?", label: copy.keys.hints.help },
  { keys: "q", label: copy.keys.hints.quit },
];

/** Shown on the focused panel's bottom border and listed in Help; esc is handled by every panel. */
const PANEL_HINTS: Readonly<Record<FocusId, readonly ShownHint[]>> = {
  ledger: [
    { keys: "j/k", label: copy.keys.panelActions.select },
    { keys: "enter", label: copy.keys.panelActions.conjure },
    { keys: "b", label: copy.keys.panelActions.repay },
    { keys: "esc", label: copy.keys.panelActions.back },
  ],
  peasants: [
    { keys: "j/k", label: copy.keys.panelActions.select },
    { keys: "f/w/m/i", label: copy.keys.panelActions.assign },
    { keys: "esc", label: copy.keys.panelActions.back },
  ],
  archive: [
    { keys: "j/k", label: copy.keys.panelActions.select },
    { keys: "enter", label: copy.keys.panelActions.buy },
    { keys: "esc", label: copy.keys.panelActions.back },
  ],
  court: [
    { keys: "j/k", label: copy.keys.panelActions.select },
    { keys: "enter", label: copy.keys.panelActions.choose },
    { keys: "esc", label: copy.keys.panelActions.back },
  ],
  decrees: [
    { keys: "j/k", label: copy.keys.panelActions.select },
    { keys: "enter", label: copy.keys.panelActions.write },
    { keys: "x", label: copy.keys.panelActions.repeal },
    { keys: "esc", label: copy.keys.panelActions.back },
  ],
  crown: [
    { keys: "enter", label: copy.keys.panelActions.deliver },
    { keys: "f", label: copy.keys.panelActions.forge },
    { keys: "esc", label: copy.keys.panelActions.back },
  ],
};

export function keyHints(unlocks: readonly string[]): ShownHint[] {
  return GLOBAL_HINTS.filter(
    (hint) => hint.needs === undefined || unlocks.includes(hint.needs),
  ).map(({ keys, label }) => ({ keys, label }));
}

export function panelKeyHints(panel: FocusId): readonly ShownHint[] {
  return PANEL_HINTS[panel];
}

/** The key shown for one of a panel's hints, found by the label the hint carries. */
export function panelHintKey(panel: FocusId, label: string): string {
  const hint = PANEL_HINTS[panel].find(
    (candidate) => candidate.label === label,
  );
  if (hint === undefined) throw new Error(`${panel} has no hint ${label}`);
  return hint.keys;
}

/**
 * OpenTUI drops a border title that does not fit, so a narrow panel gives up esc first, which Help
 * covers for every panel, and then the labels, rather than losing its hints altogether.
 */
export function panelHintsText(panel: FocusId, width: number): string {
  const hints = panelKeyHints(panel);
  const labelled = (shown: readonly ShownHint[]) =>
    shown.map((hint) => `${hint.keys} ${hint.label}`).join(" \u00b7 ");
  const withoutEscape = hints.filter((hint) => hint.keys !== "esc");
  return (
    [labelled(hints), labelled(withoutEscape)].find(
      (text) => text.length <= width,
    ) ?? hints.map((hint) => hint.keys).join(" ")
  );
}

/** The short list on the right of the bottom bar; everything else is in Help. */
export const BAR_HINTS = copy.keys.barHints;

/** Reminds the player of the palette on the left of the bottom bar, and is empty until it is owned. */
export function barCommandsText(unlocks: readonly string[]): string {
  return unlocks.includes(PALETTE_UNLOCK) ? copy.keys.barCommands : "";
}
