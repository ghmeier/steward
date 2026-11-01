import { describe, expect, test } from "bun:test";
import type { Command } from "../src/core/commands";
import {
	type Condition,
	type Decree,
	PETITIONS,
	parseDecree,
} from "../src/core/decree";
import { enactDecree, policiesFor } from "../src/core/decree-engine";
import { createNewGame } from "../src/core/state";
import { CHAINING_UNLOCK, COMPOUND_UNLOCK } from "../src/core/unlocks";
import { computeView } from "../src/core/view";
import {
	decreeLine,
	type LineState,
	lineKey,
	openLine,
	parseLine,
	renderLine,
} from "../src/tui/command-line";
import { describePolicy, formatDecree } from "../src/tui/decree-format";
import type { KeyPress } from "../src/tui/keys";
import type { MenuContext } from "../src/tui/menu";
import { grantUnlocks, tuning } from "./helpers";

const granary: Decree = {
	id: "granary",
	petition: "harvest",
	rules: [],
	otherwise: "sell",
};

function contextWith(
	options: { unlocks?: string[]; decrees?: Decree[] } = {},
): MenuContext {
	const state = createNewGame(1, tuning);
	grantUnlocks(state, options.unlocks ?? []);
	for (const decree of options.decrees ?? []) {
		const result = enactDecree(state, decree, tuning);
		if (!result.ok) throw new Error(result.reason);
	}
	return { view: computeView(state, tuning), tuning };
}

const everything = contextWith({
	unlocks: [COMPOUND_UNLOCK, CHAINING_UNLOCK],
	decrees: [{ ...granary, id: "harvest" }],
});
const fresh = contextWith();

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

function typeText(
	state: LineState,
	text: string,
	context: MenuContext,
): LineState {
	let current = state;
	for (const character of text) {
		const name = character === " " ? "space" : character;
		const result = lineKey(
			current,
			key(name, { sequence: character }),
			context,
		);
		if (result.state === null) throw new Error("line closed");
		current = result.state;
	}
	return current;
}

function suggestionTexts(text: string, context: MenuContext): string[] {
	return parseLine(text, context).suggestions.map((s) => s.text);
}

const compare = (
	quantity: "grain" | "grainSeasons" | "coin" | "idle" | "wood",
	comparison: "above" | "below",
	value: number,
): Condition => ({ kind: "compare", quantity, comparison, value });

const laborPolicies = policiesFor("labor", tuning);
const [laborA = "", laborB = ""] = laborPolicies;

const roundTripDecrees: Decree[] = [
	{ id: "harvest", petition: "harvest", rules: [], otherwise: "stockpile" },
	{
		id: "harvest",
		petition: "harvest",
		rules: [
			{ when: compare("grainSeasons", "above", 3), policy: "sell" },
			{ when: compare("grainSeasons", "above", 0.5), policy: "feed" },
		],
		otherwise: "stockpile",
	},
	{
		id: "wood",
		petition: "wood",
		rules: [{ when: compare("idle", "below", 75), policy: "sell" }],
		otherwise: "stockpile",
	},
	{
		id: "ore",
		petition: "ore",
		rules: [{ when: { kind: "season", season: "winter" }, policy: "sell" }],
		otherwise: "stockpile",
	},
	{
		id: "labor",
		petition: "labor",
		rules: [
			{ when: { kind: "season", season: "winter" }, policy: laborA },
			{ when: compare("coin", "above", 100), policy: laborB },
			{ when: compare("grain", "below", 20), policy: laborA },
		],
		otherwise: laborB,
	},
	{
		id: "labor",
		petition: "labor",
		rules: [
			{
				when: {
					kind: "all",
					conditions: [
						compare("coin", "above", 1),
						{ kind: "not", condition: { kind: "season", season: "spring" } },
					],
				},
				policy: laborA,
			},
			{
				when: {
					kind: "any",
					conditions: [
						{ kind: "season", season: "autumn" },
						compare("grainSeasons", "below", 1),
					],
				},
				policy: laborB,
			},
		],
		otherwise: laborA,
	},
	{
		id: "wood",
		petition: "wood",
		rules: [
			{
				when: { kind: "not", condition: compare("coin", "below", 5) },
				policy: "stockpile",
			},
			{
				when: { kind: "chose", decree: "harvest", policy: "feed" },
				policy: "sell",
			},
		],
		otherwise: "stockpile",
	},
];

describe("decreeLine and parseLine", () => {
	test.each(
		roundTripDecrees.map((decree) => [decreeLine(decree, tuning), decree]),
	)("parsing %s rebuilds the decree", (line, decree) => {
		const result = parseLine(line, everything);

		expect(result.problem).toBeNull();
		expect(result.command).toEqual({ type: "enactDecree", decree });
	});

	test("a rule's comma is optional when typing", () => {
		const withComma = parseLine(
			"decree harvest sell when coin above 5, feed when coin above 2 otherwise stockpile",
			fresh,
		);
		const without = parseLine(
			"decree harvest sell when coin above 5 feed when coin above 2 otherwise stockpile",
			fresh,
		);

		expect(withComma.command).not.toBeNull();
		expect(without.command).toEqual(withComma.command);
	});

	test("a decree for a petition that has an active decree reuses its id", () => {
		const context = contextWith({ decrees: [granary] });

		const result = parseLine("decree harvest otherwise sell", context);

		expect(result.command).toEqual({
			type: "enactDecree",
			decree: { ...granary, rules: [] },
		});
	});

	test("a two-word quantity is matched as one quantity", () => {
		const result = parseLine(
			"decree harvest sell when grain seasons above 2 otherwise feed",
			fresh,
		);

		expect(result.command).toMatchObject({
			decree: { rules: [{ when: { quantity: "grainSeasons" } }] },
		});
	});

	test("a number may be a decimal", () => {
		const result = parseLine(
			"decree harvest sell when coin above 0.5 otherwise feed",
			fresh,
		);

		expect(result.command).toMatchObject({
			decree: { rules: [{ when: { value: 0.5 } }] },
		});
	});

	test("an incomplete decree has no command and no problem", () => {
		const result = parseLine("decree harvest sell when coin above ", fresh);

		expect(result.command).toBeNull();
		expect(result.problem).toBeNull();
	});

	test("text after a complete decree is a problem", () => {
		const result = parseLine("decree harvest otherwise sell now", fresh);

		expect(result.command).toBeNull();
		expect(result.problem).not.toBeNull();
	});

	test("a word that fits nowhere is a problem with no suggestions", () => {
		const result = parseLine("decree harvest banana", fresh);

		expect(result.problem).toContain("banana");
		expect(result.suggestions).toEqual([]);
	});

	test("more rules than the decree limit gives a problem and no command", () => {
		const rule = "sell when coin above 1";
		const rules = Array(tuning.decrees.maxRules + 1).fill(rule);
		const line = `decree harvest ${rules.join(", ")} otherwise feed`;

		const result = parseLine(line, fresh);

		expect(result.command).toBeNull();
		expect(result.problem).toContain(String(tuning.decrees.maxRules));
	});

	test("exactly the decree limit of rules is accepted", () => {
		const rule = "sell when coin above 1";
		const rules = Array(tuning.decrees.maxRules).fill(rule);

		const result = parseLine(
			`decree harvest ${rules.join(", ")} otherwise feed`,
			fresh,
		);

		expect(result.command).not.toBeNull();
	});
});

describe("suggestions", () => {
	const afterWhen = "decree harvest sell when ";

	test("compound words are absent until compound conditions are owned", () => {
		const owned = contextWith({ unlocks: [COMPOUND_UNLOCK] });

		expect(suggestionTexts(afterWhen, fresh)).not.toContain("not");
		expect(suggestionTexts(afterWhen, owned)).toContain("not");
		expect(suggestionTexts(`${afterWhen}coin above 1 `, fresh)).not.toContain(
			"and",
		);
		expect(suggestionTexts(`${afterWhen}coin above 1 `, owned)).toEqual(
			expect.arrayContaining(["and", "or"]),
		);
	});

	test("chose and decree ids are absent until chaining is owned", () => {
		const decrees = [{ ...granary, id: "harvest" }];
		const locked = contextWith({ decrees });
		const owned = contextWith({ decrees, unlocks: [CHAINING_UNLOCK] });
		const text = "decree wood sell when harvest ";

		expect(suggestionTexts("decree wood sell when ", locked)).not.toContain(
			"harvest",
		);
		expect(suggestionTexts("decree wood sell when ", owned)).toContain(
			"harvest",
		);
		expect(parseLine(text, locked).problem).not.toBeNull();
		expect(suggestionTexts(text, owned)).toEqual(["chose"]);
	});

	test("a chose condition offers the policies of the named decree's petition", () => {
		const text = "decree wood sell when harvest chose ";

		expect(suggestionTexts(text, everything)).toEqual([
			...policiesFor("harvest", tuning),
		]);
	});

	test("a partial word keeps only the suggestions that start with it", () => {
		const all = suggestionTexts("decree ", fresh);
		const partial = suggestionTexts("decree w", fresh);

		expect(all).toEqual([...PETITIONS]);
		expect(partial).toEqual(["wood"]);
	});

	test("a multi-word quantity is suggested while its first word is typed", () => {
		const texts = suggestionTexts(`${afterWhen}grain`, fresh);

		expect(texts).toEqual(["grain", "grain seasons"]);
	});

	test("after the first word of a multi-word quantity both continuations are offered", () => {
		const texts = suggestionTexts(`${afterWhen}grain `, fresh);

		expect(texts).toEqual(
			expect.arrayContaining(["above", "below", "grain seasons"]),
		);
	});

	test("policy suggestions carry the policy description", () => {
		const result = parseLine("decree wood ", fresh);

		expect(result.suggestions).toContainEqual({
			text: "sell",
			description: describePolicy("wood", "sell", tuning),
		});
	});

	test("every policy of every petition is offered as the otherwise policy", () => {
		for (const petition of PETITIONS) {
			const texts = suggestionTexts(`decree ${petition} otherwise `, fresh);

			expect(texts).toEqual([...policiesFor(petition, tuning)]);
		}
	});

	test("every policy of every petition can be typed as the otherwise policy", () => {
		for (const petition of PETITIONS) {
			for (const policy of policiesFor(petition, tuning)) {
				const result = parseLine(
					`decree ${petition} otherwise ${policy}`,
					fresh,
				);

				expect(result.command).toMatchObject({
					decree: { petition, otherwise: policy },
				});
			}
		}
	});

	test("when full of rules only otherwise is offered", () => {
		const rule = "sell when coin above 1, ";
		const line = `decree harvest ${rule.repeat(tuning.decrees.maxRules)}`;

		expect(suggestionTexts(line, fresh)).toEqual(["otherwise"]);
	});
});

describe("compound conditions", () => {
	const owned = contextWith({ unlocks: [COMPOUND_UNLOCK] });
	const decreeOf = (line: string, context: MenuContext) => {
		const command: Command | null = parseLine(line, context).command;
		return command?.type === "enactDecree"
			? parseDecree(command.decree, tuning.decrees)
			: null;
	};

	test("mixing and with or in one rule gives a problem and no command", () => {
		const line =
			"decree wood sell when coin above 1 and idle above 2 or ore above 3 otherwise stockpile";

		const result = parseLine(line, owned);

		expect(result.command).toBeNull();
		expect(result.problem).toContain("and");
	});

	test("after and, or is not suggested", () => {
		const texts = suggestionTexts(
			"decree wood sell when coin above 1 and idle above 2 ",
			owned,
		);

		expect(texts).toContain("and");
		expect(texts).not.toContain("or");
	});

	test("atoms joined by and make an all condition", () => {
		const decree = decreeOf(
			"decree wood sell when coin above 1 and idle above 2 otherwise stockpile",
			owned,
		);

		expect(decree?.rules[0]?.when.kind).toBe("all");
	});

	test("atoms joined by or make an any condition", () => {
		const decree = decreeOf(
			"decree wood sell when coin above 1 or not idle above 2 otherwise stockpile",
			owned,
		);

		expect(decree?.rules[0]?.when).toEqual({
			kind: "any",
			conditions: [
				compare("coin", "above", 1),
				{ kind: "not", condition: compare("idle", "above", 2) },
			],
		});
	});

	test("a condition deeper than the decree limits gives a problem and no command", () => {
		const atoms = Array(tuning.decrees.maxConditionNodes + 1).fill(
			"coin above 1",
		);
		const line = `decree wood sell when ${atoms.join(" and ")} otherwise stockpile`;

		const result = parseLine(line, owned);

		expect(result.command).toBeNull();
		expect(result.problem).not.toBeNull();
	});
});

describe("repeal", () => {
	const active = contextWith({ decrees: [granary] });

	test("repeal offers only the ids of decrees in force", () => {
		expect(suggestionTexts("repeal ", active)).toEqual(["granary"]);
		expect(suggestionTexts("repeal ", fresh)).toEqual([]);
	});

	test("repeal of an active id issues a repeal command", () => {
		const result = parseLine("repeal granary", active);

		expect(result.command).toEqual({ type: "repealDecree", id: "granary" });
	});

	test("repeal of an unknown id is a problem with no command", () => {
		const result = parseLine("repeal harvest ", active);

		expect(result.command).toBeNull();
		expect(result.problem).not.toBeNull();
	});

	test("repeal with nothing in force says so", () => {
		expect(parseLine("repeal ", fresh).problem).toContain("no decrees");
	});
});

describe("lineKey", () => {
	test("printable characters and space append to the text", () => {
		const state = lineKey(
			openLine("decree"),
			key("space", { sequence: " " }),
			fresh,
		).state;
		const next = lineKey(state ?? openLine(""), key("w"), fresh).state;

		expect(next?.text).toBe("decree w");
	});

	test("a shifted character appends what the terminal sent", () => {
		const result = lineKey(
			openLine(""),
			key("a", { shift: true, sequence: "A" }),
			fresh,
		);

		expect(result.state?.text).toBe("A");
	});

	test("backspace erases one character", () => {
		const result = lineKey(openLine("decree w"), key("backspace"), fresh);

		expect(result.state?.text).toBe("decree ");
	});

	test("ctrl and meta keys leave the line unchanged", () => {
		const state = openLine("decree ");

		const ctrl = lineKey(state, key("a", { ctrl: true }), fresh);
		const meta = lineKey(state, key("a", { meta: true }), fresh);

		expect(ctrl).toEqual({ state, commands: [] });
		expect(meta).toEqual({ state, commands: [] });
	});

	test("escape closes the line without a command", () => {
		const result = lineKey(openLine("decree "), key("escape"), fresh);

		expect(result).toEqual({ state: null, commands: [] });
	});

	test("tab completes the partial word and adds a space", () => {
		const result = lineKey(openLine("decree wo"), key("tab"), fresh);

		expect(result.state?.text).toBe("decree wood ");
	});

	test("down moves the highlight and tab completes that suggestion", () => {
		const down = lineKey(openLine("decree "), key("down"), fresh).state;
		const result = lineKey(down ?? openLine(""), key("tab"), fresh);

		expect(result.state?.text).toBe(`decree ${PETITIONS[1]} `);
	});

	test("up at the top keeps the highlight at the first suggestion", () => {
		const result = lineKey(openLine("decree "), key("up"), fresh);

		expect(result.state?.highlight).toBe(0);
	});

	test("tab completion keeps a comma already typed", () => {
		const result = lineKey(
			openLine("decree harvest sell when coin above 1, f"),
			key("tab"),
			fresh,
		);

		expect(result.state?.text).toBe(
			"decree harvest sell when coin above 1, feed ",
		);
	});

	test("enter on an incomplete line issues nothing, completes the highlight and stays open", () => {
		const result = lineKey(openLine("decree "), key("return"), fresh);

		expect(result.commands).toEqual([]);
		expect(result.state?.text).toBe("decree harvest ");
	});

	test("enter on a complete line issues one enactDecree and closes", () => {
		const result = lineKey(
			openLine("decree harvest otherwise sell"),
			key("return"),
			fresh,
		);

		expect(result.state).toBeNull();
		expect(result.commands).toHaveLength(1);
		expect(result.commands[0]).toMatchObject({ type: "enactDecree" });
	});

	test("typing a whole decree key by key ends in an enactDecree on enter", () => {
		const text =
			"decree harvest sell when grain seasons above 2, feed when it is winter otherwise stockpile";
		const typed = typeText(openLine(""), text, fresh);

		const result = lineKey(typed, key("return"), fresh);

		expect(result.commands).toHaveLength(1);
		expect(result.state).toBeNull();
	});
});

describe("an active decree named like a quantity", () => {
	const woodDecree: Decree = {
		id: "wood",
		petition: "wood",
		rules: [],
		otherwise: "stockpile",
	};
	const context = contextWith({
		unlocks: [CHAINING_UNLOCK],
		decrees: [woodDecree],
	});

	test("wood followed by chose builds a chose condition", () => {
		const result = parseLine(
			"decree harvest feed when wood chose sell otherwise stockpile",
			context,
		);

		expect(result.command).toMatchObject({
			decree: {
				rules: [{ when: { kind: "chose", decree: "wood", policy: "sell" } }],
			},
		});
	});

	test("wood followed by above builds a compare condition", () => {
		const result = parseLine(
			"decree harvest feed when wood above 3 otherwise stockpile",
			context,
		);

		expect(result.command).toMatchObject({
			decree: { rules: [{ when: compare("wood", "above", 3) }] },
		});
	});
});

describe("condition limits", () => {
	const owned = contextWith({ unlocks: [COMPOUND_UNLOCK] });
	const atoms = (count: number) =>
		Array(count).fill("coin above 1").join(" and ");

	test("and is no longer offered when another condition would exceed the node limit", () => {
		const room = tuning.decrees.maxConditionNodes - 2;
		const before = `decree wood sell when ${atoms(room)} `;
		const full = `decree wood sell when ${atoms(room + 1)} `;

		expect(suggestionTexts(before, owned)).toContain("and");
		expect(suggestionTexts(full, owned)).not.toContain("and");
	});

	test("a problem from the condition limits is worded without field paths", () => {
		const line = `decree wood sell when ${atoms(tuning.decrees.maxConditionNodes)} otherwise stockpile`;

		const { problem } = parseLine(line, owned);

		expect(problem).toContain("at most");
		expect(problem).not.toContain("conditions[");
	});

	test("not twice in a row gives a problem", () => {
		const { problem } = parseLine("decree wood sell when not not ", owned);

		expect(problem).toContain("not");
	});
});

describe("renderLine", () => {
	test("the first line shows the text with a cursor and the highlight is marked", () => {
		const render = renderLine(openLine("decree "), fresh);

		expect(render.title).toBe("Command");
		expect(render.lines[0]).toBe(": decree _");
		expect(render.lines[1]?.startsWith("> harvest")).toBe(true);
		expect(render.lines[2]?.startsWith("  wood")).toBe(true);
		expect(render.hints).toBe("type · tab complete · enter issue · esc close");
	});

	test("at most six suggestions are shown", () => {
		const render = renderLine(openLine("decree wood sell when "), fresh);

		const suggestionLines = render.lines.slice(1, render.lines.indexOf(""));

		expect(suggestionLines.length).toBeLessThanOrEqual(6);
	});

	test("decrees in force are listed below, or the line says there are none", () => {
		const active = contextWith({ decrees: [granary] });

		const withDecree = renderLine(openLine("decree "), active).lines;
		const without = renderLine(openLine("decree "), fresh).lines;

		expect(withDecree.join("\n")).toContain(formatDecree(granary));
		expect(without.at(-1)).toBe("No decrees are in force.");
	});

	test("a problem is shown after the suggestions", () => {
		const render = renderLine(openLine("decree banana"), fresh);

		expect(render.lines.join("\n")).toContain('! "banana"');
	});
});
