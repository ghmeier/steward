import { describe, expect, test } from "bun:test";
import type { Job } from "../src/core/realm";
import { ARCHIVE_PANEL, PALETTE_UNLOCK } from "../src/core/unlocks";
import { actionForKey, type KeyPress, keyHints } from "../src/tui/keys";

const everything = [ARCHIVE_PANEL, PALETTE_UNLOCK];

function key(name: string, modifiers: Partial<KeyPress> = {}): KeyPress {
	return {
		name,
		ctrl: false,
		meta: false,
		shift: false,
		sequence: name,
		...modifiers,
	};
}

describe("actionForKey", () => {
	test.each<[string, Job | "idle"]>([
		["f", "farm"],
		["w", "forest"],
		["m", "mine"],
		["i", "idle"],
	])("%s asks to assign the selected peasant to %s", (name, job) => {
		expect(actionForKey(key(name), everything)).toEqual({
			kind: "assign",
			job,
		});
	});

	test.each<[string, -1 | 1]>([
		["up", -1],
		["k", -1],
		["down", 1],
		["j", 1],
	])("%s moves the cursor by %p", (name, delta) => {
		expect(actionForKey(key(name), everything)).toEqual({
			kind: "move",
			delta,
		});
	});

	test("n asks for a new village", () => {
		expect(actionForKey(key("n"), everything)).toEqual({ kind: "newGame" });
	});

	test("s saves and q quits", () => {
		expect(actionForKey(key("s"), everything)).toEqual({ kind: "save" });
		expect(actionForKey(key("q"), everything)).toEqual({ kind: "quit" });
	});

	test("? and shift-slash both open help, plain slash does not", () => {
		expect(actionForKey(key("?"), everything)).toEqual({ kind: "help" });
		expect(actionForKey(key("/", { shift: true }), everything)).toEqual({
			kind: "help",
		});
		expect(actionForKey(key("/"), everything)).toBeNull();
	});

	test("mutating a returned action does not change later results", () => {
		const first = actionForKey(key("f"), everything);
		if (first?.kind === "assign") first.job = "mine";

		expect(actionForKey(key("f"), everything)).toEqual({
			kind: "assign",
			job: "farm",
		});
	});

	test("Ctrl-C quits", () => {
		expect(actionForKey(key("c", { ctrl: true }), everything)).toEqual({
			kind: "quit",
		});
	});

	test("held modifiers disable other bindings", () => {
		expect(actionForKey(key("s", { ctrl: true }), everything)).toBeNull();
		expect(actionForKey(key("q", { meta: true }), everything)).toBeNull();
	});

	test("an unbound key and an inherited object property map to nothing", () => {
		expect(actionForKey(key("x"), everything)).toBeNull();
		expect(actionForKey(key("constructor"), everything)).toBeNull();
	});

	test("every key advertised in the hints is bound", () => {
		const advertised = keyHints(everything).flatMap((hint) =>
			hint.keys.split("/"),
		);

		for (const name of advertised) {
			expect(actionForKey(key(name), everything)).not.toBeNull();
		}
	});

	test("a opens the archive only with the Archive panel", () => {
		expect(actionForKey(key("a"), [ARCHIVE_PANEL])).toEqual({
			kind: "line",
			prefill: "buy ",
		});
		expect(actionForKey(key("a"), [PALETTE_UNLOCK])).toBeNull();
		expect(actionForKey(key("a"), [])).toBeNull();
	});

	test("a colon, plain or as shift-semicolon, opens the palette only once it is owned", () => {
		const palette = { kind: "line", prefill: "" } as const;

		expect(actionForKey(key(":"), [PALETTE_UNLOCK])).toEqual(palette);
		expect(actionForKey(key(";", { shift: true }), [PALETTE_UNLOCK])).toEqual(
			palette,
		);
		expect(actionForKey(key(":"), [ARCHIVE_PANEL])).toBeNull();
		expect(actionForKey(key(";", { shift: true }), [])).toBeNull();
		expect(actionForKey(key(";"), [PALETTE_UNLOCK])).toBeNull();
	});

	test("d and c stay available with nothing unlocked", () => {
		expect(actionForKey(key("d"), [])).toEqual({
			kind: "line",
			prefill: "decree ",
		});
		expect(actionForKey(key("c"), [])).toEqual({ kind: "court" });
	});
});
