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
