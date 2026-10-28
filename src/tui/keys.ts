import type { Command } from "../core/commands";
import type { Job } from "../core/realm";

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

const assign = (job: Job): KeyAction => ({
	kind: "command",
	command: { type: "assignWorker", job, delta: 1 },
});

const BINDINGS: Readonly<Record<string, KeyAction>> = {
	f: assign("farm"),
	w: assign("forest"),
	m: assign("mine"),
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
	{ keys: "f/w/m", label: "assign farm/forest/mine" },
	{ keys: "s", label: "save" },
	{ keys: "q", label: "quit" },
];
