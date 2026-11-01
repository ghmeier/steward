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
/** What a key asks for; the app turns an assignment into a command for the selected peasant. */
export type KeyAction =
  | { kind: "move"; delta: -1 | 1 }
  | { kind: "assign"; job: Job }
  | { kind: "save" }
  | { kind: "line"; prefill: string }
  | { kind: "court" }
  | { kind: "help" }
  | { kind: "newGame" }
  | { kind: "quit" };

type Binding = { action: KeyAction; needs?: UnlockId };

const BINDINGS: Readonly<Record<string, Binding>> = {
  up: { action: { kind: "move", delta: -1 } },
  k: { action: { kind: "move", delta: -1 } },
  down: { action: { kind: "move", delta: 1 } },
  j: { action: { kind: "move", delta: 1 } },
  f: { action: { kind: "assign", job: Job.FARM } },
  w: { action: { kind: "assign", job: Job.FOREST } },
  m: { action: { kind: "assign", job: Job.MINE } },
  i: { action: { kind: "assign", job: Job.IDLE } },
  a: { action: { kind: "line", prefill: "buy " }, needs: ARCHIVE_PANEL },
  d: { action: { kind: "line", prefill: "decree " } },
  c: { action: { kind: "court" } },
  ":": { action: { kind: "line", prefill: "" }, needs: PALETTE_UNLOCK },
  "?": { action: { kind: "help" } },
  n: { action: { kind: "newGame" } },
  s: { action: { kind: "save" } },
  q: { action: { kind: "quit" } },
};

export function isInterrupt(key: KeyPress): boolean {
  return key.ctrl && !key.meta && key.name === "c";
}

function nameOf(key: KeyPress): string {
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
  const name = nameOf(key);
  const binding = Object.hasOwn(BINDINGS, name) ? BINDINGS[name] : undefined;
  if (binding === undefined) return null;
  if (binding.needs !== undefined && !unlocks.includes(binding.needs)) {
    return null;
  }
  // A copy keeps callers (and the command log) from sharing and mutating table entries.
  return structuredClone(binding.action);
}

type KeyHint = { keys: string; label: string; needs?: UnlockId };

const KEY_HINTS: readonly KeyHint[] = [
  { keys: "j/k", label: "select" },
  { keys: "f/w/m/i", label: "assign" },
  { keys: "a", label: "archive", needs: ARCHIVE_PANEL },
  { keys: "d", label: "decree" },
  { keys: ":", label: "commands", needs: PALETTE_UNLOCK },
  { keys: "c", label: "court" },
  { keys: "s", label: "save" },
  { keys: "n", label: "new village" },
  { keys: "?", label: "help" },
  { keys: "q", label: "quit" },
];

export function keyHints(
  unlocks: readonly string[],
): { keys: string; label: string }[] {
  return KEY_HINTS.filter(
    (hint) => hint.needs === undefined || unlocks.includes(hint.needs),
  ).map(({ keys, label }) => ({ keys, label }));
}

export function hintsText(unlocks: readonly string[]): string {
  return keyHints(unlocks)
    .map((hint) => `${hint.keys} ${hint.label}`)
    .join(" · ");
}
