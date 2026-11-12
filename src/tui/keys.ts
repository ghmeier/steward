import { copy } from "../core/copy";
import { Job } from "../core/realm";
import {
  PALETTE_UNLOCK,
  PANEL_UNLOCKS,
  type PanelId,
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
export type FocusId = PanelId;

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

type ShownHint = { keys: string; label: string };

/** What a panel declares about itself so the key tables can be derived from the panels rather than kept beside them. */
export type PanelKeys = {
  id: FocusId;
  /** The key that focuses the panel. */
  focusKey: string;
  /** Set only when focusing needs more than the unlock that shows the panel, because the panel has nothing to act on before then. */
  focusNeeds?: UnlockId;
  /** What the focus key is shown to do in the bottom bar and Help. */
  focusLabel: string;
  /** Shown on the focused panel's bottom border and listed in Help; esc is handled by every panel. */
  hints: readonly ShownHint[];
};

type Binding = { action: KeyAction; needs?: UnlockId | undefined };

const GLOBAL_BINDINGS: Readonly<Record<string, Binding>> = {
  left: { action: { kind: "cycle", delta: -1 } },
  right: { action: { kind: "cycle", delta: 1 } },
  ":": { action: { kind: "line", prefill: "" }, needs: PALETTE_UNLOCK },
  "?": { action: { kind: "help" } },
  n: { action: { kind: "newGame" } },
  s: { action: { kind: "save" } },
  q: { action: { kind: "quit" } },
};

type KeyHint = ShownHint & { needs?: UnlockId | undefined };

/** The hints for the global keys that are not panels, which follow the panel rows. */
const GLOBAL_HINTS: readonly KeyHint[] = [
  { keys: ":", label: copy.keys.hints.commands, needs: PALETTE_UNLOCK },
  { keys: "s", label: copy.keys.hints.save },
  { keys: "n", label: copy.keys.hints.newVillage },
  { keys: "?", label: copy.keys.hints.help },
  { keys: "q", label: copy.keys.hints.quit },
];

/**
 * The key tables for a set of panels, in the order the panels are given. The panels own their keys, so
 * this takes their declarations instead of listing them, and `keys.ts` stays free of the panels themselves.
 */
export class Keymap {
  private readonly bindings: Readonly<Record<string, Binding>>;

  constructor(private readonly panels: readonly PanelKeys[]) {
    this.bindings = {
      ...Object.fromEntries(
        panels.map((panel): [string, Binding] => [
          panel.focusKey,
          {
            action: { kind: "focus", panel: panel.id },
            needs: Keymap.focusNeeds(panel),
          },
        ]),
      ),
      ...GLOBAL_BINDINGS,
    };
  }

  private static focusNeeds(panel: PanelKeys): UnlockId | undefined {
    return panel.focusNeeds ?? PANEL_UNLOCKS[panel.id];
  }

  /** The focusable panels in reading order, as the arrow keys step through them. */
  get focusIds(): FocusId[] {
    return this.panels.map(({ id }) => id);
  }

  private declared(panel: FocusId): PanelKeys {
    return this.panels.find(({ id }) => id === panel) as PanelKeys;
  }

  /** The key bound to focus a panel, so prose and notices name the letter the bindings actually use. */
  keyFor(panel: FocusId): string {
    return this.declared(panel).focusKey;
  }

  /** Null for a key that is unbound, or whose unlock is not owned. */
  actionForKey(key: KeyPress, unlocks: readonly string[]): KeyAction | null {
    // In raw mode Ctrl-C arrives as a keypress, not SIGINT.
    if (isInterrupt(key)) return { kind: "quit" };
    const name = plainKeyName(key);
    if (name === null) return null;
    const binding = Object.hasOwn(this.bindings, name)
      ? this.bindings[name]
      : undefined;
    if (binding === undefined) return null;
    if (binding.needs !== undefined && !unlocks.includes(binding.needs)) {
      return null;
    }
    // A copy keeps callers (and the command log) from sharing and mutating table entries.
    return structuredClone(binding.action);
  }

  /** The panels the player owns, in reading order. */
  ownedPanels(unlocks: readonly string[]): FocusId[] {
    return this.panels
      .filter((panel) => {
        const needs = Keymap.focusNeeds(panel);
        return needs === undefined || unlocks.includes(needs);
      })
      .map(({ id }) => id);
  }

  keyHints(unlocks: readonly string[]): ShownHint[] {
    const panelRows: KeyHint[] = this.panels.map((panel) => ({
      keys: panel.focusKey,
      label: panel.focusLabel,
      needs: Keymap.focusNeeds(panel),
    }));
    return [...panelRows, ...GLOBAL_HINTS]
      .filter(
        (hint) => hint.needs === undefined || unlocks.includes(hint.needs),
      )
      .map(({ keys, label }) => ({ keys, label }));
  }

  panelKeyHints(panel: FocusId): readonly ShownHint[] {
    return this.declared(panel).hints;
  }

  /** The key shown for one of a panel's hints, found by the label the hint carries. */
  panelHintKey(panel: FocusId, label: string): string {
    const hint = this.panelKeyHints(panel).find(
      (candidate) => candidate.label === label,
    );
    if (hint === undefined) throw new Error(`${panel} has no hint ${label}`);
    return hint.keys;
  }

  /**
   * OpenTUI drops a border title that does not fit, so a narrow panel gives up esc first, which Help
   * covers for every panel, and then the labels, rather than losing its hints altogether.
   */
  panelHintsText(panel: FocusId, width: number): string {
    const hints = this.panelKeyHints(panel);
    const labelled = (shown: readonly ShownHint[]) =>
      shown.map((hint) => `${hint.keys} ${hint.label}`).join(" · ");
    const withoutEscape = hints.filter((hint) => hint.keys !== "esc");
    return (
      [labelled(hints), labelled(withoutEscape)].find(
        (text) => text.length <= width,
      ) ?? hints.map((hint) => hint.keys).join(" ")
    );
  }
}

/** The focusable panels in reading order, limited to the ones the player owns, as the arrow keys step through them. */
export class FocusRing {
  constructor(
    private readonly unlocks: readonly string[],
    private readonly keymap: Keymap,
  ) {}

  private get panels(): FocusId[] {
    return this.keymap.ownedPanels(this.unlocks);
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

export function peasantActionForKey(key: KeyPress): PeasantAction | null {
  const name = plainKeyName(key);
  if (name === null) return null;
  const action = Object.hasOwn(PEASANT_BINDINGS, name)
    ? PEASANT_BINDINGS[name]
    : undefined;
  return action === undefined ? null : structuredClone(action);
}

/** Reminds the player of the palette on the left of the bottom bar, and is empty until it is owned. */
export function barCommandsText(unlocks: readonly string[]): string {
  return unlocks.includes(PALETTE_UNLOCK) ? copy.keys.barCommands : "";
}
