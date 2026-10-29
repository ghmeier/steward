import { describe, expect, test } from "bun:test";
import type { Command } from "../src/core/commands";
import { createNewGame, type GameState } from "../src/core/state";
import { computeView } from "../src/core/view";
import { courtMenu } from "../src/tui/court-menu";
import {
	type MenuContext,
	type MenuState,
	menuKey,
	openMenu,
	renderMenu,
} from "../src/tui/menu";
import { setRoster, economyTestTuning as tuning } from "./helpers";

function villageWith(templates: string[], coin = 100): GameState {
	const state = createNewGame(1, tuning);
	setRoster(state, { idle: 10 });
	state.posting.resources.coin = coin;
	state.posting.desk.disputes = templates.map((template, index) => ({
		id: index + 1,
		template,
		parties: [1, 2],
		arrivedAt: 0,
	}));
	return state;
}

class Walker {
	state: MenuState | null;
	commands: Command[] = [];
	private context: MenuContext;
	constructor(state: GameState) {
		this.context = { view: computeView(state, tuning), tuning };
		this.state = openMenu(courtMenu);
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
	moveTo(index: number) {
		for (let i = 0; i < index; i++) this.key("down");
	}
}

describe("court menu", () => {
	test("the root lists the waiting disputes in desk order", () => {
		const state = villageWith(["hen", "boundary"]);
		const walk = new Walker(state);

		const view = computeView(state, tuning);

		const items = walk.lines().map((line) => line.slice(2));
		expect(items).toEqual(view.desk.map((entry) => entry.label));
		expect(items[0]).toContain("kept");
		expect(items[1]).toContain("accuses");
	});

	test("with no disputes the root shows a note and no items", () => {
		const walk = new Walker(villageWith([]));

		expect(walk.lines()).toEqual(["No disputes wait on the desk."]);
	});

	test("choosing an option emits exactly one settleDispute with the dispute and option ids", () => {
		const walk = new Walker(villageWith(["hen", "boundary"]));
		walk.key("down");
		walk.key("return");

		walk.moveTo(1);
		walk.key("return");

		expect(walk.commands).toEqual([
			{ type: "settleDispute", dispute: 2, option: "for-first" },
		]);
	});

	test("after settling, the menu pops back to the root so another dispute can be settled", () => {
		const walk = new Walker(villageWith(["hen", "boundary"]));
		walk.key("return");

		walk.key("return");

		expect(walk.state?.frames).toHaveLength(1);
	});

	test("options show their cost or gain, free, the default marker and the grudge", () => {
		const walk = new Walker(villageWith(["boundary"]));

		walk.key("return");

		const [pay, forFirst, forSecond] = walk.lines().slice(1);
		expect(pay).toContain("−10 coin");
		expect(pay).toContain("(the default if ignored)");
		expect(pay).not.toContain("sulk");
		expect(forFirst).toContain("+5 grain");
		expect(forFirst).toContain("will sulk for a season)");
		expect(forSecond).toContain("free");
		expect(forSecond).not.toContain("(the default if ignored)");
	});

	test("the sulking party is named", () => {
		const state = villageWith(["boundary"]);
		const walk = new Walker(state);
		walk.key("return");

		const forFirst = walk.lines()[2];

		const second = state.posting.delegates[1]?.name as string;
		expect(forFirst).toContain(`(${second} will sulk for a season)`);
	});

	test("an option the village cannot afford is disabled and emits nothing", () => {
		const walk = new Walker(villageWith(["boundary"], 0));
		walk.key("return");

		expect(walk.lines()[1]).toContain("(unavailable)");
		walk.key("return");

		expect(walk.commands).toEqual([]);
		expect(walk.state?.frames).toHaveLength(2);
	});
});
