import type { Command } from "../core/commands";
import { copy } from "../core/copy";
import type { Tuning } from "../core/tuning";
import type { GameView } from "../core/view";
import type { KeyPress } from "./keys";

export type MenuContext = { view: GameView; tuning: Tuning };

/** Something a menu asks the app to do that is not a game command, so it never enters the command log. */
export type AppRequest = "newGame";

/** What choosing an item (or accepting a number) does. `pop` counts screens removed before any push. */
export type MenuAction =
  | { kind: "push"; screen: ScreenBuilder }
  | { kind: "replace"; pop: number; screen?: ScreenBuilder }
  | { kind: "command"; command: Command; after: "close" | "pop" }
  | { kind: "app"; request: AppRequest }
  | { kind: "close" };

export type MenuItem = {
  label: string;
  action: MenuAction;
  disabled?: boolean;
  /** Shown under the list while this item is selected. */
  detail?: string;
};

export type Screen =
  | {
      kind: "list";
      title: string;
      notes?: string[];
      items: MenuItem[];
    }
  | {
      kind: "number";
      title: string;
      notes?: string[];
      onAccept: (value: number) => MenuAction;
    };

/** Screens are rebuilt from the live context on every key and draw so the menu never shows a stale view. */
export type ScreenBuilder = (context: MenuContext) => Screen;

type Frame = { build: ScreenBuilder; cursor: number; text: string };
export type MenuState = { readonly frames: readonly Frame[] };

export type MenuStep = {
  state: MenuState | null;
  commands: Command[];
  requests: AppRequest[];
};
export type MenuRender = { title: string; lines: string[]; hints: string };

/** The keys `menuKey` acts on in a list screen; it swallows every other key, so an embedding panel checks this first. */
export const LIST_KEYS: ReadonlySet<string> = new Set([
  "up",
  "down",
  "j",
  "k",
  "return",
  "enter",
  "escape",
]);

export function openMenu(root: ScreenBuilder): MenuState {
  return { frames: [{ build: root, cursor: 0, text: "" }] };
}

function clampCursor(screen: Screen, cursor: number): number {
  if (screen.kind !== "list") return 0;
  return Math.max(0, Math.min(cursor, screen.items.length - 1));
}

function applyAction(
  frames: readonly Frame[],
  action: MenuAction,
): {
  frames: readonly Frame[] | null;
  commands: Command[];
  requests: AppRequest[];
} {
  switch (action.kind) {
    case "close":
      return { frames: null, commands: [], requests: [] };
    case "app":
      return { frames: null, commands: [], requests: [action.request] };
    case "push":
      return {
        frames: [...frames, { build: action.screen, cursor: 0, text: "" }],
        commands: [],
        requests: [],
      };
    case "replace": {
      const kept = frames.slice(0, Math.max(0, frames.length - action.pop));
      if (action.screen !== undefined) {
        return {
          frames: [...kept, { build: action.screen, cursor: 0, text: "" }],
          commands: [],
          requests: [],
        };
      }
      return {
        frames: kept.length === 0 ? null : kept,
        commands: [],
        requests: [],
      };
    }
    case "command":
      return {
        frames: action.after === "close" ? null : frames.slice(0, -1),
        commands: [action.command],
        requests: [],
      };
  }
}

function finish(result: ReturnType<typeof applyAction>): MenuStep {
  const frames = result.frames;
  return {
    state: frames === null || frames.length === 0 ? null : { frames },
    commands: result.commands,
    requests: result.requests,
  };
}

function replaceTop(state: MenuState, top: Frame): MenuState {
  return { frames: [...state.frames.slice(0, -1), top] };
}

/** Feeds one key to the menu. A null state means the menu closed. */
export function menuKey(
  state: MenuState,
  key: KeyPress,
  context: MenuContext,
): MenuStep {
  const top = state.frames.at(-1);
  if (top === undefined) return { state: null, commands: [], requests: [] };
  const screen = top.build(context);
  const stay: MenuStep = { state, commands: [], requests: [] };
  if (key.ctrl || key.meta) return stay;

  if (key.name === "escape") {
    return finish(applyAction(state.frames, { kind: "replace", pop: 1 }));
  }

  if (screen.kind === "list") {
    const cursor = clampCursor(screen, top.cursor);
    if (key.name === "up" || key.name === "k") {
      return {
        state: replaceTop(state, { ...top, cursor: Math.max(0, cursor - 1) }),
        commands: [],
        requests: [],
      };
    }
    if (key.name === "down" || key.name === "j") {
      const last = Math.max(0, screen.items.length - 1);
      return {
        state: replaceTop(state, {
          ...top,
          cursor: Math.min(last, cursor + 1),
        }),
        commands: [],
        requests: [],
      };
    }
    if (key.name === "return" || key.name === "enter") {
      const item = screen.items[cursor];
      if (item === undefined || item.disabled === true) return stay;
      return finish(applyAction(state.frames, item.action));
    }
    return stay;
  }

  if (key.name === "backspace") {
    return {
      state: replaceTop(state, { ...top, text: top.text.slice(0, -1) }),
      commands: [],
      requests: [],
    };
  }
  if (key.name === "return" || key.name === "enter") {
    const value = /\d/.test(top.text) ? Number(top.text) : Number.NaN;
    if (!Number.isFinite(value)) return stay;
    return finish(applyAction(state.frames, screen.onAccept(value)));
  }
  const typed = key.name;
  const accepted =
    /^\d$/.test(typed) || (typed === "." && !top.text.includes("."));
  if (accepted) {
    return {
      state: replaceTop(state, { ...top, text: top.text + typed }),
      commands: [],
      requests: [],
    };
  }
  return stay;
}

export function renderMenu(state: MenuState, context: MenuContext): MenuRender {
  const top = state.frames.at(-1);
  if (top === undefined) return { title: "", lines: [], hints: "" };
  const screen = top.build(context);
  const lines = [...(screen.notes ?? [])];
  if (screen.kind === "number") {
    lines.push(`> ${top.text}_`);
    return { title: screen.title, lines, hints: copy.menus.numberHints };
  }
  const cursor = clampCursor(screen, top.cursor);
  for (const [index, item] of screen.items.entries()) {
    const marker = index === cursor ? ">" : " ";
    const label =
      item.disabled === true
        ? copy.menus.unavailable({ label: item.label })
        : item.label;
    lines.push(`${marker} ${label}`);
  }
  const detail = screen.items[cursor]?.detail;
  if (detail !== undefined) lines.push("", detail);
  const hints =
    state.frames.length === 1
      ? copy.menus.listHintsClose
      : copy.menus.listHintsBack;
  return { title: screen.title, lines, hints };
}
