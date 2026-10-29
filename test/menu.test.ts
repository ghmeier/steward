import { describe, expect, test } from "bun:test";
import { createNewGame } from "../src/core/state";
import { computeView } from "../src/core/view";
import type { KeyPress } from "../src/tui/keys";
import {
	type MenuContext,
	type MenuState,
	menuKey,
	openMenu,
	renderMenu,
	type ScreenBuilder,
} from "../src/tui/menu";
import { tuning } from "./helpers";

const context: MenuContext = {
	view: computeView(createNewGame(1, tuning), tuning),
	tuning,
};

function key(name: string, modifiers: Partial<KeyPress> = {}): KeyPress {
	return { name, ctrl: false, meta: false, shift: false, ...modifiers };
}

function press(state: MenuState, ...names: string[]): MenuState {
	let current = state;
	for (const name of names) {
		const step = menuKey(current, key(name), context);
		if (step.state === null) throw new Error("menu closed");
		current = step.state;
	}
	return current;
}

const leaf: ScreenBuilder = () => ({
	kind: "list",
	title: "Leaf",
	items: [{ label: "only", action: { kind: "close" } }],
});
const root: ScreenBuilder = () => ({
	kind: "list",
	title: "Root",
	items: [
		{ label: "alpha", action: { kind: "push", screen: leaf } },
		{
			label: "beta",
			action: {
				kind: "command",
				command: { type: "repealDecree", id: "x" },
				after: "close",
			},
		},
		{ label: "gamma", action: { kind: "close" } },
	],
});
const numeric: ScreenBuilder = () => ({
	kind: "number",
	title: "Amount",
	onAccept: (value) => ({
		kind: "command",
		command: { type: "repealDecree", id: String(value) },
		after: "close",
	}),
});

const title = (state: MenuState) => renderMenu(state, context).title;
const marked = (state: MenuState) =>
	renderMenu(state, context).lines.findIndex((line) => line.startsWith(">"));

describe("menu cursor", () => {
	test("j and down move the cursor and k and up move it back", () => {
		const state = press(openMenu(root), "j", "down", "k");

		expect(marked(state)).toBe(1);
	});

	test("the cursor stops at the first and last items", () => {
		const top = press(openMenu(root), "up", "k");
		const bottom = press(openMenu(root), "j", "j", "j", "j", "down");

		expect(marked(top)).toBe(0);
		expect(marked(bottom)).toBe(2);
	});
});

describe("menu navigation", () => {
	test("enter on a push item opens the next screen", () => {
		const state = press(openMenu(root), "return");

		expect(title(state)).toBe("Leaf");
	});

	test("escape goes back one screen and closes from the root", () => {
		const nested = press(openMenu(root), "return");

		const back = menuKey(nested, key("escape"), context);
		const closed = menuKey(back.state as MenuState, key("escape"), context);

		expect(title(back.state as MenuState)).toBe("Root");
		expect(closed.state).toBeNull();
		expect(closed.commands).toEqual([]);
	});

	test("a command item emits exactly one command and closes", () => {
		const step = menuKey(press(openMenu(root), "j"), key("return"), context);

		expect(step.commands).toEqual([{ type: "repealDecree", id: "x" }]);
		expect(step.state).toBeNull();
	});

	test("pop after a command returns to the previous screen", () => {
		const inner: ScreenBuilder = () => ({
			kind: "list",
			title: "Inner",
			items: [
				{
					label: "go",
					action: {
						kind: "command",
						command: { type: "repealDecree", id: "y" },
						after: "pop",
					},
				},
			],
		});
		const outer: ScreenBuilder = () => ({
			kind: "list",
			title: "Outer",
			items: [{ label: "in", action: { kind: "push", screen: inner } }],
		});

		const step = menuKey(
			press(openMenu(outer), "return"),
			key("return"),
			context,
		);

		expect(step.commands).toHaveLength(1);
		expect(title(step.state as MenuState)).toBe("Outer");
	});

	test("a disabled item does nothing when chosen", () => {
		const disabled: ScreenBuilder = () => ({
			kind: "list",
			title: "D",
			items: [{ label: "no", disabled: true, action: { kind: "close" } }],
		});

		const step = menuKey(openMenu(disabled), key("return"), context);

		expect(step.state).not.toBeNull();
	});
});

describe("menu numeric field", () => {
	const typed = (...names: string[]) => press(openMenu(numeric), ...names);
	const field = (state: MenuState) =>
		renderMenu(state, context).lines.join("|");

	test("digits and one point are accepted and letters are ignored", () => {
		const state = typed("1", "a", ".", "5", ".", "x", "2");

		expect(field(state)).toBe("> 1.52_");
	});

	test("backspace removes the last character", () => {
		expect(field(typed("1", "2", "backspace"))).toBe("> 1_");
	});

	test("enter accepts a finite number and passes it to the screen", () => {
		const step = menuKey(typed("2", ".", "5"), key("return"), context);

		expect(step.commands).toEqual([{ type: "repealDecree", id: "2.5" }]);
	});

	test.each([[[]], [["."]]])(
		"enter on %p is rejected and keeps the field open",
		(names) => {
			const step = menuKey(typed(...names), key("return"), context);

			expect(step.commands).toEqual([]);
			expect(step.state).not.toBeNull();
		},
	);
});

describe("menu app requests", () => {
	const asking: ScreenBuilder = () => ({
		kind: "list",
		title: "Ask",
		items: [{ label: "go", action: { kind: "app", request: "newGame" } }],
	});

	test("an app item returns the request, emits no command and closes", () => {
		const step = menuKey(openMenu(asking), key("return"), context);

		expect(step.requests).toEqual(["newGame"]);
		expect(step.commands).toEqual([]);
		expect(step.state).toBeNull();
	});

	test("a command item returns no app request", () => {
		const step = menuKey(press(openMenu(root), "j"), key("return"), context);

		expect(step.requests).toEqual([]);
	});
});
