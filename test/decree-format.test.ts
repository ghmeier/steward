import { describe, expect, test } from "bun:test";
import type { Condition, Decree } from "../src/core/decree";
import { formatDecree } from "../src/tui/decree-format";

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
