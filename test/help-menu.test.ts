import { describe, expect, test } from "bun:test";
import { policiesFor } from "../src/core/decree-engine";
import { createNewGame } from "../src/core/state";
import type { Tuning } from "../src/core/tuning";
import { computeView } from "../src/core/view";
import { describePolicy } from "../src/tui/decree-format";
import { helpMenu } from "../src/tui/help-menu";
import { KEY_HINTS } from "../src/tui/keys";
import { menuKey, openMenu, renderMenu } from "../src/tui/menu";
import { tuning } from "./helpers";

function topicText(topic: string, using: Tuning = tuning): string {
	const context = {
		view: computeView(createNewGame(1, using), using),
		tuning: using,
	};
	const root = openMenu(helpMenu);
	const index = renderMenu(root, context).lines.findIndex((line) =>
		line.includes(topic),
	);
	let state = root;
	const press = (name: string) => {
		const step = menuKey(
			state,
			{ name, ctrl: false, meta: false, shift: false, sequence: name },
			context,
		);
		if (step.state === null) throw new Error("menu closed");
		state = step.state;
	};
	for (let i = 0; i < index; i++) press("down");
	press("return");
	return renderMenu(state, context).lines.join("\n");
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function withEconomy(changes: Partial<Tuning["economy"]>): Tuning {
	return { ...tuning, economy: { ...tuning.economy, ...changes } };
}

describe("help topics follow tuning", () => {
	test("coin shows the grain, wood and ore prices from tuning", () => {
		const text = topicText(
			"Coin",
			withEconomy({ grainPrice: 0.25, woodPrice: 0.75, orePrice: 3 }),
		);

		expect(text).toContain(
			"grain at 0.25 coin each, wood at 0.75 and ore at 3",
		);
	});

	test("grain shows the feeding cost, population cap and season length from tuning", () => {
		const changed = withEconomy({
			grainPerPeasant: 45,
			maxPopulation: 77,
			ticksPerSeason: 1200,
		});

		const text = topicText("Grain and growth", changed);

		expect(text).toContain("every 45 grain");
		expect(text).toContain("77 peasants");
		expect(text).toContain("120 s");
	});

	test("a farmer feeds the year-round average, not the best season", () => {
		const text = topicText(
			"Grain and growth",
			withEconomy({
				grainPerFarmer: 0.03,
				grainPerPerson: 0.01,
				seasonYield: { spring: 0.5, summer: 1, autumn: 0.5, winter: 0 },
			}),
		);

		expect(text).toContain("feeds about 1.5 peasants");
	});

	test("the barren-season warning names only seasons whose yield is zero", () => {
		const barrenAutumn = withEconomy({
			seasonYield: { spring: 1, summer: 1, autumn: 0, winter: 1 },
		});
		const allGrow = withEconomy({
			seasonYield: { spring: 1, summer: 1, autumn: 1, winter: 1 },
		});

		expect(topicText("Grain and growth", barrenAutumn)).toContain(
			"Autumn grows nothing",
		);
		expect(topicText("Grain and growth", allGrow)).not.toContain(
			"grows nothing",
		);
	});

	test("grain shows what a season of eating costs each peasant and the famine rule", () => {
		const text = topicText(
			"Grain and growth",
			withEconomy({
				grainPerPerson: 0.02,
				ticksPerSeason: 500,
			}),
		);

		expect(text).toContain("costs each peasant 10 grain");
		expect(text).toContain(
			"a famine takes at most half the village, spread over a season (50 s)",
		);
		expect(text).toContain("famine ends as soon as everyone eats again");
	});

	test("labor moves are pluralized by count", () => {
		expect(
			topicText("Harvest and labor", withEconomy({ laborMovesPerTick: 1 })),
		).toContain("1 peasant moves");
		expect(
			topicText("Harvest and labor", withEconomy({ laborMovesPerTick: 3 })),
		).toContain("3 peasants move");
	});

	test("wood and ore show per-second rates converted with the step length", () => {
		const changed = { ...withEconomy({ woodPerWorker: 0.03 }), stepMs: 250 };

		const text = topicText("Wood and ore", changed);

		expect(text).toContain("0.12/s");
	});

	test("disputes and promotion show village values from tuning", () => {
		const changed: Tuning = {
			...tuning,
			village: {
				...tuning.village,
				deskSlots: 5,
				grudgeTicks: 300,
				promotionPopulation: 33,
			},
		};

		expect(topicText("Disputes", changed)).toContain("5 slots");
		expect(topicText("Disputes", changed)).toContain("30 s");
		expect(topicText("Promotion", changed)).toContain("33 peasants");
	});

	test("decrees list every labor allocation with its percentages", () => {
		const changed = withEconomy({
			laborAllocations: {
				...tuning.economy.laborAllocations,
				lumber: { farm: 0.1, forest: 0.8, mine: 0.1 },
			},
		});

		const text = topicText("Harvest and labor", changed);

		for (const name of policiesFor("labor", changed)) {
			expect(text).toContain(describePolicy("labor", name, changed));
		}
		expect(text).toContain("lumber: farm 10%, forest 80%, mine 10%");
	});
});

function withRulingCosts(resources: Record<string, number>): Tuning {
	const [first] = tuning.village.disputes;
	if (first === undefined) throw new Error("no dispute template");
	const dispute = {
		...first,
		options: first.options.map((option) => ({
			id: option.id,
			label: option.label,
		})),
	};
	const [head, ...rest] = dispute.options;
	if (head === undefined) throw new Error("no option");
	return {
		...tuning,
		village: {
			...tuning.village,
			disputes: [{ ...dispute, options: [{ ...head, resources }, ...rest] }],
		},
	};
}

describe("help claims about resource use follow the disputes", () => {
	test("wood is said to pay for rulings only when a ruling costs wood", () => {
		expect(topicText("Wood and ore", withRulingCosts({ wood: -2 }))).toContain(
			"Wood pays for some dispute rulings.",
		);
		expect(topicText("Wood and ore", withRulingCosts({ coin: -2 }))).toContain(
			"Wood has no use yet.",
		);
	});

	test("ore is said to be unused unless a ruling costs ore", () => {
		expect(topicText("Wood and ore", withRulingCosts({ ore: -1 }))).toContain(
			"Ore pays for some dispute rulings.",
		);
		expect(topicText("Wood and ore", withRulingCosts({ wood: -1 }))).toContain(
			"Ore has no use yet.",
		);
	});

	test("coin is said to be spent on rulings only when a ruling costs coin", () => {
		expect(topicText("Coin", withRulingCosts({ coin: -2 }))).toContain(
			"Coin is spent on dispute rulings.",
		);
		expect(topicText("Coin", withRulingCosts({ grain: -2 }))).not.toContain(
			"spent on dispute rulings",
		);
	});

	test("coin fines are mentioned only when a ruling pays coin", () => {
		expect(topicText("Coin", withRulingCosts({ coin: 2 }))).toContain("fines");
		expect(topicText("Coin", withRulingCosts({ coin: -2 }))).not.toContain(
			"fines",
		);
	});
});

describe("help keys topic", () => {
	test("lists every key hint", () => {
		const text = topicText("Keys");

		for (const hint of KEY_HINTS) {
			const row = text.split("\n").find((line) => line.startsWith(hint.keys));
			expect(row).toMatch(
				new RegExp(`^${escapeRegExp(hint.keys)} +${escapeRegExp(hint.label)}$`),
			);
		}
	});
});
