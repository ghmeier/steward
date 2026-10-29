import { describe, expect, test } from "bun:test";
import type { Condition, Decree } from "../src/core/decree";
import { describePolicy, formatDecree } from "../src/tui/decree-format";
import { tuning } from "./helpers";

function decreeWith(when: Condition): Decree {
	return {
		id: "granary",
		petition: "harvest",
		rules: [{ when, policy: "sell" }],
		otherwise: "stockpile",
	};
}

describe("formatDecree", () => {
	test("a compare rule reads as a quantity, direction and number", () => {
		const decree: Decree = {
			id: "granary",
			petition: "harvest",
			rules: [
				{
					when: {
						kind: "compare",
						quantity: "grainSeasons",
						comparison: "above",
						value: 3,
					},
					policy: "sell",
				},
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
		};

		expect(formatDecree(decree)).toBe(
			"granary (harvest): sell when grain seasons above 3; feed when grain seasons above 2; otherwise stockpile",
		);
	});

	test("a season rule names the season", () => {
		expect(formatDecree(decreeWith({ kind: "season", season: "winter" }))).toBe(
			"granary (harvest): sell when it is winter; otherwise stockpile",
		);
	});

	test("a chose rule names the decree and the policy it chose", () => {
		const text = formatDecree(
			decreeWith({ kind: "chose", decree: "workers", policy: "balanced" }),
		);

		expect(text).toContain("sell when workers chose balanced");
	});

	test("all and any list their conditions", () => {
		const parts: Condition[] = [
			{ kind: "season", season: "spring" },
			{ kind: "compare", quantity: "coin", comparison: "below", value: 5 },
		];

		expect(
			formatDecree(decreeWith({ kind: "all", conditions: parts })),
		).toContain("when all of (it is spring, coin below 5)");
		expect(
			formatDecree(decreeWith({ kind: "any", conditions: parts })),
		).toContain("when any of (it is spring, coin below 5)");
	});

	test("not wraps its inner condition", () => {
		const text = formatDecree(
			decreeWith({
				kind: "not",
				condition: { kind: "season", season: "summer" },
			}),
		);

		expect(text).toContain("when not (it is summer)");
	});

	test("a decree with no rules shows only the otherwise policy", () => {
		const bare: Decree = {
			id: "labor",
			petition: "labor",
			rules: [],
			otherwise: "balanced",
		};

		expect(formatDecree(bare)).toBe("labor (labor): otherwise balanced");
	});
});

describe("describePolicy", () => {
	const inline = {
		...tuning,
		economy: {
			...tuning.economy,
			laborAllocations: {
				lumberjacks: { farm: 0, forest: 1, mine: 0 },
				halves: { farm: 0.25, forest: 0.25, mine: 0.5 },
			},
		},
	};

	test("a single-job labor policy says everyone does that job", () => {
		expect(describePolicy("labor", "lumberjacks", inline)).toBe(
			"lumberjacks: everyone works the forest",
		);
	});

	test("a mixed labor split lists each job with its percentage", () => {
		expect(describePolicy("labor", "halves", inline)).toBe(
			"halves: farm 25%, forest 25%, mine 50%",
		);
	});

	test("wood and ore policies name their resource", () => {
		expect(describePolicy("wood", "sell", tuning)).toBe(
			"sell: the wood is sold for coin",
		);
		expect(describePolicy("ore", "stockpile", tuning)).toBe(
			"stockpile: the ore is stored",
		);
	});

	test("each harvest policy says what happens to the surplus", () => {
		expect(describePolicy("harvest", "feed", tuning)).toBe(
			"feed: the surplus grows the village",
		);
		expect(describePolicy("harvest", "sell", tuning)).toBe(
			"sell: the surplus is sold for coin",
		);
		expect(describePolicy("harvest", "stockpile", tuning)).toBe(
			"stockpile: the surplus is stored",
		);
	});
});
