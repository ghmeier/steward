import { describe, expect, test } from "bun:test";
import type { Job } from "../src/core/realm";
import { actionForKey, KEY_HINTS, type KeyPress } from "../src/tui/keys";

function key(name: string, modifiers: Partial<KeyPress> = {}): KeyPress {
	return { name, ctrl: false, meta: false, shift: false, ...modifiers };
}

describe("actionForKey", () => {
	test.each<[string, Job | "idle"]>([
		["f", "farm"],
		["w", "forest"],
		["m", "mine"],
		["i", "idle"],
	])("%s asks to assign the selected peasant to %s", (name, job) => {
		expect(actionForKey(key(name))).toEqual({ kind: "assign", job });
	});

	test.each<[string, -1 | 1]>([
		["up", -1],
		["k", -1],
		["down", 1],
		["j", 1],
	])("%s moves the cursor by %p", (name, delta) => {
		expect(actionForKey(key(name))).toEqual({ kind: "move", delta });
	});

	test("s saves and q quits", () => {
		expect(actionForKey(key("s"))).toEqual({ kind: "save" });
		expect(actionForKey(key("q"))).toEqual({ kind: "quit" });
	});

	test("? and shift-slash both open help, plain slash does not", () => {
		expect(actionForKey(key("?"))).toEqual({ kind: "help" });
		expect(actionForKey(key("/", { shift: true }))).toEqual({ kind: "help" });
		expect(actionForKey(key("/"))).toBeNull();
	});

	test("mutating a returned action does not change later results", () => {
		const first = actionForKey(key("f"));
		if (first?.kind === "assign") first.job = "mine";

		expect(actionForKey(key("f"))).toEqual({ kind: "assign", job: "farm" });
	});

	test("Ctrl-C quits", () => {
		expect(actionForKey(key("c", { ctrl: true }))).toEqual({ kind: "quit" });
	});

	test("held modifiers disable other bindings", () => {
		expect(actionForKey(key("s", { ctrl: true }))).toBeNull();
		expect(actionForKey(key("q", { meta: true }))).toBeNull();
	});

	test("an unbound key and an inherited object property map to nothing", () => {
		expect(actionForKey(key("x"))).toBeNull();
		expect(actionForKey(key("constructor"))).toBeNull();
	});

	test("every key advertised in the hints is bound", () => {
		const advertised = KEY_HINTS.flatMap((hint) => hint.keys.split("/"));

		for (const name of advertised) {
			expect(actionForKey(key(name))).not.toBeNull();
		}
	});
});
