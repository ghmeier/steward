import type { Command } from "../core/commands";

export type KeyPress = {
	name: string;
	ctrl: boolean;
	meta: boolean;
	shift: boolean;
};
export type KeyAction =
	| { kind: "command"; command: Command }
	| { kind: "save" }
	| { kind: "quit" };

export const RATE_KEY_STEP = 0.5;

const BINDINGS: Readonly<Record<string, KeyAction>> = {
	"+": {
		kind: "command",
		command: { type: "adjustToyRate", delta: RATE_KEY_STEP },
	},
	"=": {
		kind: "command",
		command: { type: "adjustToyRate", delta: RATE_KEY_STEP },
	},
	"-": {
		kind: "command",
		command: { type: "adjustToyRate", delta: -RATE_KEY_STEP },
	},
	s: { kind: "save" },
	q: { kind: "quit" },
};

export function actionForKey(key: KeyPress): KeyAction | null {
	// In raw mode Ctrl-C arrives as a keypress, not SIGINT.
	if (key.ctrl && !key.meta && key.name === "c") return { kind: "quit" };
	if (key.ctrl || key.meta) return null;
	const action = Object.hasOwn(BINDINGS, key.name)
		? BINDINGS[key.name]
		: undefined;
	// A copy keeps callers (and the command log) from sharing and mutating table entries.
	return action === undefined ? null : structuredClone(action);
}

export const KEY_HINTS: readonly { keys: string; label: string }[] = [
	{ keys: "+/-", label: "growth rate" },
	{ keys: "s", label: "save" },
	{ keys: "q", label: "quit" },
];
