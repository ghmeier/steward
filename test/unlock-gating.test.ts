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

type Surfaces = ReturnType<typeof surfaces>;

type Checks = Record<string, boolean>;

// Each row names what an owned unlock reveals; every check must be false without it and true with it.
// biome-ignore format: one row per line keeps the table scannable
const gated: [string, string, (s: Surfaces) => Checks][] = [
	["panel.archive", ARCHIVE_PANEL, (s) => ({
		key: s.action("a")?.kind === "line", hint: s.hints.includes("a archive"),
		help: /^a +archive$/m.test(s.keysHelp), buyVerb: s.verbs.includes("buy"),
	})],
	["control.palette", PALETTE_UNLOCK, (s) => ({
		colon: s.action(":")?.kind === "line", semicolon: s.action(";", { shift: true })?.kind === "line",
		hint: s.hints.includes(": commands"), help: /^: +commands$/m.test(s.keysHelp), assignVerb: s.verbs.includes("assign"),
	})],
	["control.savedDecrees", SAVED_DECREES_UNLOCK, (s) => ({
		saveVerb: s.verbs.includes("save"), enactVerb: s.verbs.includes("enact"), help: s.decreesHelp.includes("save <name>"),
	})],
	["decree.compound", COMPOUND_UNLOCK, (s) => ({
		and: s.afterCondition.includes("and"), or: s.afterCondition.includes("or"),
		not: s.startOfCondition.includes("not"), help: s.decreesHelp.includes("Join conditions"),
	})],
	["decree.chaining", CHAINING_UNLOCK, (s) => ({
		subject: s.startOfCondition.includes(granary.id), help: s.decreesHelp.includes("chose"),
	})],
];

const all = (checks: Checks, value: boolean) =>
	Object.fromEntries(Object.keys(checks).map((name) => [name, value]));

describe("unlock gating", () => {
	test.each(gated)(
		"%s surfaces appear only once owned",
		(_name, unlock, reveals) => {
			const before = reveals(surfaces([]));
			const after = reveals(surfaces([unlock]));

			expect(before).toEqual(all(before, false));
			expect(after).toEqual(all(after, true));
		},
	);
});
