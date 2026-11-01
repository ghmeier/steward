import { describe, expect, test } from "bun:test";
import type { Decree } from "../src/core/decree";
import { enactDecree } from "../src/core/decree-engine";
import { createNewGame } from "../src/core/state";
import {
	ARCHIVE_PANEL,
	CHAINING_UNLOCK,
	COMPOUND_UNLOCK,
	PALETTE_UNLOCK,
	SAVED_DECREES_UNLOCK,
} from "../src/core/unlocks";
import { computeView } from "../src/core/view";
import { parseLine } from "../src/tui/command-line";
import { actionForKey, hintsText, type KeyPress } from "../src/tui/keys";
import { grantUnlocks, topicText, tuning } from "./helpers";

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

const granary: Decree = {
	id: "granary",
	petition: "harvest",
	rules: [],
	otherwise: "sell",
};

/** Everything the player can see of a control, built from a real state holding exactly these unlocks. */
function surfaces(unlocks: readonly string[]) {
	const state = createNewGame(1, tuning);
	grantUnlocks(state, unlocks);
	const enacted = enactDecree(state, granary, tuning);
	if (!enacted.ok) throw new Error(enacted.reason);
	const context = { view: computeView(state, tuning), tuning };
	const owned = context.view.unlocks;
	const words = (text: string) =>
		parseLine(text, context).suggestions.map((s) => s.text);
	return {
		action: (name: string, modifiers: Partial<KeyPress> = {}) =>
			actionForKey(key(name, modifiers), owned),
		hints: hintsText(owned),
		keysHelp: topicText("Keys", tuning, unlocks),
		decreesHelp: topicText("Decrees", tuning, unlocks),
		verbs: words(""),
		afterCondition: words("decree wood sell when coin above 5 "),
		startOfCondition: words("decree wood sell when "),
	};
}

describe("panel.archive", () => {
	test("the a key, its hint, its help line and the buy verb are absent before it is owned", () => {
		const before = surfaces([]);

		expect(before.action("a")).toBeNull();
		expect(before.hints).not.toContain("a archive");
		expect(before.keysHelp).not.toContain("archive");
		expect(before.verbs).not.toContain("buy");
	});

	test("the a key, its hint, its help line and the buy verb appear once it is owned", () => {
		const after = surfaces([ARCHIVE_PANEL]);

		expect(after.action("a")).toEqual({ kind: "line", prefill: "buy " });
		expect(after.hints).toContain("a archive");
		expect(after.keysHelp).toMatch(/^a +archive$/m);
		expect(after.verbs).toContain("buy");
	});
});

describe("control.palette", () => {
	test("the colon key, its hint, its help line and the assign verb are absent before it is owned", () => {
		const before = surfaces([]);

		expect(before.action(":")).toBeNull();
		expect(before.action(";", { shift: true })).toBeNull();
		expect(before.hints).not.toContain(": commands");
		expect(before.keysHelp).not.toContain("commands");
		expect(before.verbs).not.toContain("assign");
	});

	test("the colon key, its hint, its help line and the assign verb appear once it is owned", () => {
		const after = surfaces([PALETTE_UNLOCK]);

		expect(after.action(":")).toEqual({ kind: "line", prefill: "" });
		expect(after.action(";", { shift: true })).toEqual({
			kind: "line",
			prefill: "",
		});
		expect(after.hints).toContain(": commands");
		expect(after.keysHelp).toMatch(/^: +commands$/m);
		expect(after.verbs).toContain("assign");
	});
});

describe("control.savedDecrees", () => {
	test("the save and enact verbs and their help are absent before it is owned", () => {
		const before = surfaces([]);

		expect(before.verbs).not.toContain("save");
		expect(before.verbs).not.toContain("enact");
		expect(before.decreesHelp).not.toContain("save <name>");
	});

	test("the save and enact verbs and their help appear once it is owned", () => {
		const after = surfaces([SAVED_DECREES_UNLOCK]);

		expect(after.verbs).toContain("save");
		expect(after.verbs).toContain("enact");
		expect(after.decreesHelp).toContain("save <name>");
	});
});

describe("decree.compound", () => {
	test("and, or, not and their help are absent before it is owned", () => {
		const before = surfaces([]);

		expect(before.afterCondition).not.toContain("and");
		expect(before.afterCondition).not.toContain("or");
		expect(before.startOfCondition).not.toContain("not");
		expect(before.decreesHelp).not.toContain("Join conditions");
	});

	test("and, or, not and their help appear once it is owned", () => {
		const after = surfaces([COMPOUND_UNLOCK]);

		expect(after.afterCondition).toContain("and");
		expect(after.afterCondition).toContain("or");
		expect(after.startOfCondition).toContain("not");
		expect(after.decreesHelp).toContain("Join conditions");
	});
});

describe("decree.chaining", () => {
	test("a decree in force as a condition subject and its help are absent before it is owned", () => {
		const before = surfaces([]);

		expect(before.startOfCondition).not.toContain(granary.id);
		expect(before.decreesHelp).not.toContain("chose");
	});

	test("a decree in force as a condition subject and its help appear once it is owned", () => {
		const after = surfaces([CHAINING_UNLOCK]);

		expect(after.startOfCondition).toContain(granary.id);
		expect(after.decreesHelp).toContain("chose");
	});
});
