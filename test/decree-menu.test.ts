import { describe, expect, test } from "bun:test";
import type { Command } from "../src/core/commands";
import type { Decree } from "../src/core/decree";
import { createNewGame } from "../src/core/state";
import { computeView } from "../src/core/view";
import { decreeMenu } from "../src/tui/decree-menu";
import {
	type MenuContext,
	type MenuState,
	menuKey,
	openMenu,
	renderMenu,
} from "../src/tui/menu";
import { tuning } from "./helpers";

function contextWith(decrees: Decree[]): MenuContext {
	const state = createNewGame(1, tuning);
	for (const decree of decrees) state.posting.decrees[decree.id] = decree;
	return { view: computeView(state, tuning), tuning };
}

const granary: Decree = {
	id: "granary",
	petition: "harvest",
	rules: [],
	otherwise: "sell",
};

class Walker {
	state: MenuState | null;
	commands: Command[] = [];
	constructor(private context: MenuContext) {
		this.state = openMenu(decreeMenu);
	}
	key(name: string) {
		if (this.state === null) throw new Error("menu closed");
		const step = menuKey(
			this.state,
			{ name, ctrl: false, meta: false, shift: false },
			this.context,
		);
		this.state = step.state;
		this.commands.push(...step.commands);
	}
	lines(): string[] {
		return this.state === null
			? []
			: renderMenu(this.state, this.context).lines;
	}
	choose(label: string) {
		const index = this.lines().findIndex((line) =>
			line.slice(2).startsWith(label),
		);
		if (index < 0)
			throw new Error(`no item "${label}" in ${this.lines().join("|")}`);
		const current = this.lines().findIndex((line) => line.startsWith(">"));
		for (let i = current; i < index; i++) this.key("down");
		for (let i = current; i > index; i--) this.key("up");
		this.key("return");
	}
	type(text: string) {
		for (const char of text) this.key(char);
		this.key("return");
	}
}

describe("decree menu", () => {
	test("enacting a harvest rule with otherwise stockpile emits that decree under the id harvest", () => {
		const walk = new Walker(contextWith([]));

		walk.choose("Enact harvest decree");
		walk.choose("Add rule");
		walk.choose("A quantity");
		walk.choose("grain seasons");
		walk.choose("above");
		walk.type("2");
		walk.choose("feed");
		walk.choose("Otherwise");
		walk.choose("stockpile");
		walk.choose("Enact");

		expect(walk.commands).toEqual([
			{
				type: "enactDecree",
				decree: {
					id: "harvest",
					petition: "harvest",
					rules: [
						{
							when: {
								kind: "compare",
								quantity: "grainSeasons",
								comparison: "above",
								value: 2,
							},
							policy: "feed",
						},
					],
					otherwise: "stockpile",
				},
			},
		]);
		expect(walk.state).toBeNull();
	});

	test("enacting for a petition with an active decree reuses its id", () => {
		const walk = new Walker(contextWith([granary]));

		walk.choose("Enact harvest decree");
		walk.choose("Enact");

		const [command] = walk.commands;
		expect(command).toMatchObject({
			type: "enactDecree",
			decree: { id: "granary", rules: [] },
		});
	});

	test("the draft starts with the first policy as otherwise", () => {
		const walk = new Walker(contextWith([]));

		walk.choose("Enact labor decree");

		const [first] = Object.keys(tuning.economy.laborAllocations).sort();
		expect(walk.lines().join("|")).toContain(`Otherwise: ${first}`);
	});

	test("add rule is unavailable once the draft holds maxRules rules", () => {
		const walk = new Walker(contextWith([]));
		walk.choose("Enact harvest decree");

		for (let i = 0; i < tuning.decrees.maxRules; i++) {
			walk.choose("Add rule");
			walk.choose("It is a given season");
			walk.choose("spring");
			walk.choose("feed");
		}

		expect(walk.lines().join("|")).toContain("Add rule (unavailable)");
		const before = walk.lines();
		walk.choose("Add rule");
		expect(walk.lines()).toEqual(before);
	});

	test("remove last rule drops only the newest rule", () => {
		const walk = new Walker(contextWith([]));
		walk.choose("Enact harvest decree");
		for (const season of ["spring", "winter"]) {
			walk.choose("Add rule");
			walk.choose("It is a given season");
			walk.choose(season);
			walk.choose("sell");
		}

		walk.choose("Remove last rule");
		walk.choose("Enact");

		const [command] = walk.commands;
		const rules = (command as { decree: Decree }).decree.rules;
		expect(rules.map((rule) => rule.when)).toEqual([
			{ kind: "season", season: "spring" },
		]);
	});

	test("the season path emits a season condition", () => {
		const walk = new Walker(contextWith([]));

		walk.choose("Enact harvest decree");
		walk.choose("Add rule");
		walk.choose("It is a given season");
		walk.choose("winter");
		walk.choose("sell");
		walk.choose("Enact");

		const [command] = walk.commands;
		expect((command as { decree: Decree }).decree.rules).toEqual([
			{ when: { kind: "season", season: "winter" }, policy: "sell" },
		]);
	});

	test("an active decree with rules the menu cannot build is flagged on the draft screen", () => {
		const hard: Decree = {
			...granary,
			rules: [
				{
					when: {
						kind: "not",
						condition: { kind: "season", season: "winter" },
					},
					policy: "feed",
				},
			],
		};
		const flagged = new Walker(contextWith([hard]));
		const plain = new Walker(contextWith([granary]));

		flagged.choose("Enact harvest decree");
		plain.choose("Enact harvest decree");

		expect(flagged.lines().join("|")).toContain(
			'Enacting will replace "granary"',
		);
		expect(plain.lines().join("|")).not.toContain("Enacting will replace");
	});

	test("repeal emits repealDecree for the chosen decree", () => {
		const other: Decree = {
			id: "workers",
			petition: "labor",
			rules: [],
			otherwise: "balanced",
		};
		const walk = new Walker(contextWith([granary, other]));

		walk.choose("Repeal");
		walk.choose("workers");

		expect(walk.commands).toEqual([{ type: "repealDecree", id: "workers" }]);
	});

	test("the root screen lists each active decree as a summary line", () => {
		const walk = new Walker(contextWith([granary]));

		expect(walk.lines().join("|")).toContain(
			"granary (harvest): otherwise sell",
		);
	});
});
