import type { Job } from "../core/realm";

export type KeyPress = {
	name: string;
	ctrl: boolean;
	meta: boolean;
	shift: boolean;
};
/** What a key asks for; the app turns an assignment into a command for the selected peasant. */
export type KeyAction =
	| { kind: "move"; delta: -1 | 1 }
	| { kind: "assign"; job: Job | "idle" }
	| { kind: "save" }
	| { kind: "decrees" }
	| { kind: "court" }
	| { kind: "help" }
	| { kind: "newGame" }
	| { kind: "quit" };

const BINDINGS: Readonly<Record<string, KeyAction>> = {
	up: { kind: "move", delta: -1 },
	k: { kind: "move", delta: -1 },
	down: { kind: "move", delta: 1 },
	j: { kind: "move", delta: 1 },
	f: { kind: "assign", job: "farm" },
	w: { kind: "assign", job: "forest" },
	m: { kind: "assign", job: "mine" },
	i: { kind: "assign", job: "idle" },
	d: { kind: "decrees" },
	c: { kind: "court" },
	"?": { kind: "help" },
	n: { kind: "newGame" },
	s: { kind: "save" },
	q: { kind: "quit" },
};

export function isInterrupt(key: KeyPress): boolean {
	return key.ctrl && !key.meta && key.name === "c";
}

export function actionForKey(key: KeyPress): KeyAction | null {
	// In raw mode Ctrl-C arrives as a keypress, not SIGINT.
	if (isInterrupt(key)) return { kind: "quit" };
	if (key.ctrl || key.meta) return null;
	// Kitty-protocol terminals report ? as shift plus the slash key.
	const name = key.name === "/" && key.shift ? "?" : key.name;
	const action = Object.hasOwn(BINDINGS, name) ? BINDINGS[name] : undefined;
	// A copy keeps callers (and the command log) from sharing and mutating table entries.
	return action === undefined ? null : structuredClone(action);
}

export const KEY_HINTS: readonly { keys: string; label: string }[] = [
	{ keys: "j/k", label: "select" },
	{ keys: "f/w/m/i", label: "assign farm/forest/mine/idle" },
	{ keys: "d", label: "decrees" },
	{ keys: "c", label: "court" },
	{ keys: "s", label: "save" },
	{ keys: "n", label: "new village" },
	{ keys: "?", label: "help" },
	{ keys: "q", label: "quit" },
];

export const HINTS_TEXT = KEY_HINTS.map(
	(hint) => `${hint.keys} ${hint.label}`,
).join(" · ");
