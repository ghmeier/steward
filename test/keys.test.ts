import { describe, expect, test } from "bun:test";
import type { Job } from "../src/core/realm";
import { actionForKey, KEY_HINTS, type KeyPress } from "../src/tui/keys";

function key(name: string, modifiers: Partial<KeyPress> = {}): KeyPress {
	return { name, ctrl: false, meta: false, shift: false, ...modifiers };
}

describe("actionForKey", () => {
	test.each<[string, Job]>([
		["f", "farm"],
		["w", "forest"],
		["m", "mine"],
	])("%s assigns one idle peasant to the %s", (name, job) => {
		expect(actionForKey(key(name))).toEqual({
			kind: "command",
			command: { type: "assignWorker", job, delta: 1 },
		});
	});

	test("s saves and q quits", () => {
		expect(actionForKey(key("s"))).toEqual({ kind: "save" });
		expect(actionForKey(key("q"))).toEqual({ kind: "quit" });
	});

	test("mutating a returned action does not change later results", () => {
		const first = actionForKey(key("f"));
		if (first?.kind === "command" && first.command.type === "assignWorker") {
			first.command.delta = 99;
		}

		expect(actionForKey(key("f"))).toEqual({
			kind: "command",
			command: { type: "assignWorker", job: "farm", delta: 1 },
		});
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
