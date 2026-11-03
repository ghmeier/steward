import { Job } from "../core/realm";
import { ARCHIVE_PANEL, PALETTE_UNLOCK, type UnlockId } from "../core/unlocks";

export type KeyPress = {
  name: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  /** The text the terminal sent for this key, which is what a text field appends. */
  sequence: string;
};
export type FocusId = "peasants" | "archive" | "court" | "decrees";

/** What a global key asks for; the focused panel owns every other key, including peasant assignment. */
export type KeyAction =
  | { kind: "focus"; panel: FocusId }
  | { kind: "save" }
  | { kind: "line"; prefill: string }
  | { kind: "help" }
  | { kind: "newGame" }
  | { kind: "quit" };

/** What a key asks of the peasants panel; the panel turns an assignment into a command for the selected peasant. */
export type PeasantAction =
  | { kind: "move"; delta: -1 | 1 }
  | { kind: "assign"; job: Job };

type Binding<T> = { action: T; needs?: UnlockId };

const BINDINGS: Readonly<Record<string, Binding<KeyAction>>> = {
  p: { action: { kind: "focus", panel: "peasants" } },
  a: { action: { kind: "focus", panel: "archive" }, needs: ARCHIVE_PANEL },
  c: { action: { kind: "focus", panel: "court" } },
  d: { action: { kind: "focus", panel: "decrees" } },
  ":": { action: { kind: "line", prefill: "" }, needs: PALETTE_UNLOCK },
  "?": { action: { kind: "help" } },
  n: { action: { kind: "newGame" } },
  s: { action: { kind: "save" } },
  q: { action: { kind: "quit" } },
};

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

export function isInterrupt(key: KeyPress): boolean {
  return key.ctrl && !key.meta && key.name === "c";
}

export function keyName(key: KeyPress): string {
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
  if (key.ctrl || key.meta) return null;
  const name = keyName(key);
  const binding = Object.hasOwn(BINDINGS, name) ? BINDINGS[name] : undefined;
  if (binding === undefined) return null;
  if (binding.needs !== undefined && !unlocks.includes(binding.needs)) {
    return null;
  }
  // A copy keeps callers (and the command log) from sharing and mutating table entries.
  return structuredClone(binding.action);
}

export function peasantActionForKey(key: KeyPress): PeasantAction | null {
  if (key.ctrl || key.meta) return null;
  const name = keyName(key);
  const action = Object.hasOwn(PEASANT_BINDINGS, name)
    ? PEASANT_BINDINGS[name]
    : undefined;
  return action === undefined ? null : structuredClone(action);
}

type KeyHint = { keys: string; label: string; needs?: UnlockId };

const GLOBAL_HINTS: readonly KeyHint[] = [
  { keys: "p", label: "peasants" },
  { keys: "a", label: "archive", needs: ARCHIVE_PANEL },
  { keys: "c", label: "court" },
  { keys: "d", label: "decrees" },
  { keys: ":", label: "commands", needs: PALETTE_UNLOCK },
  { keys: "s", label: "save" },
  { keys: "n", label: "new village" },
  { keys: "?", label: "help" },
  { keys: "q", label: "quit" },
];

/** Shown on the focused panel's bottom border and listed in Help; esc is handled by every panel. */
const PANEL_HINTS: Readonly<Record<FocusId, readonly KeyHint[]>> = {
  peasants: [
    { keys: "j/k", label: "select" },
    { keys: "f/w/m/i", label: "assign" },
    { keys: "esc", label: "back" },
  ],
  archive: [
    { keys: "j/k", label: "select" },
    { keys: "enter", label: "buy" },
    { keys: "esc", label: "back" },
  ],
  court: [
    { keys: "j/k", label: "select" },
    { keys: "enter", label: "choose" },
    { keys: "esc", label: "back" },
  ],
  decrees: [
    { keys: "j/k", label: "select" },
    { keys: "enter", label: "write" },
    { keys: "x", label: "repeal" },
    { keys: "esc", label: "back" },
  ],
};

type ShownHint = { keys: string; label: string };

export function keyHints(unlocks: readonly string[]): ShownHint[] {
  return GLOBAL_HINTS.filter(
    (hint) => hint.needs === undefined || unlocks.includes(hint.needs),
  ).map(({ keys, label }) => ({ keys, label }));
}

export function panelKeyHints(panel: FocusId): ShownHint[] {
  return PANEL_HINTS[panel].map(({ keys, label }) => ({ keys, label }));
}

/**
 * OpenTUI drops a border title that does not fit, so a narrow panel falls back to the bare keys
 * rather than losing its hints altogether.
 */
export function panelHintsText(
  panel: FocusId,
  width = Number.POSITIVE_INFINITY,
) {
  const hints = panelKeyHints(panel);
  const full = hints
    .map((hint) => `${hint.keys} ${hint.label}`)
    .join(" \u00b7 ");
  return full.length <= width ? full : hints.map((hint) => hint.keys).join(" ");
}

/** The short list on the right of the bottom bar; everything else is in Help. */
export function barHintsText(unlocks: readonly string[]): string {
  const base = "(?)Help (N)ew village (Q)uit";
  return unlocks.includes(PALETTE_UNLOCK) ? `${base} : commands` : base;
}
