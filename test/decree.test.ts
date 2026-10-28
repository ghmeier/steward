import { describe, expect, test } from "bun:test";
import {
	type Condition,
	type Decree,
	type DecreeLimits,
	decreeReferences,
	orderDecrees,
	parseCondition,
	parseDecree,
} from "../src/core/decree";

const limits: DecreeLimits = {
	maxRules: 2,
	maxConditionNodes: 4,
	maxConditionDepth: 3,
};

const winter: Condition = { kind: "season", season: "winter" };

function chose(decree: string): Condition {
	return { kind: "chose", decree, policy: "sell" };
}

function decree(id: string, when?: Condition): Decree {
	return {
		id,
		petition: "harvest",
		rules: when ? [{ when, policy: "feed" }] : [],
		otherwise: "sell",
	};
}

function records(...decrees: Decree[]): Record<string, Decree> {
	return Object.fromEntries(decrees.map((entry) => [entry.id, entry]));
}

function rejection(run: () => unknown): string {
	try {
		run();
	} catch (error) {
		return (error as Error).message;
	}
	return "";
}

function withRule(when: unknown): unknown {
	return { ...decree("a"), rules: [{ when, policy: "feed" }] };
}

describe("parseDecree", () => {
	test("a decree without rules parses to an equal object that shares nothing with the input", () => {
		const input = decree("granary");

		const parsed = parseDecree(input, limits);
		input.rules.push({ when: winter, policy: "feed" });
		input.otherwise = "feed";

		expect(parsed).toEqual(decree("granary"));
	});

	test("nested conditions of every kind parse to an equal object", () => {
		const when: Condition = {
			kind: "all",
			conditions: [
				{
					kind: "compare",
					quantity: "grainSeasons",
					comparison: "above",
					value: 2,
				},
				{
					kind: "any",
					conditions: [winter, { kind: "not", condition: chose("b") }],
				},
			],
		};
		const input = decree("a", when);

		expect(
			parseDecree(structuredClone(input), {
				...limits,
				maxConditionNodes: 6,
				maxConditionDepth: 4,
			}),
		).toEqual(input);
	});

	test.each([
		[
			"unknown petition",
			{ ...decree("a"), petition: "tax" },
			"decree.petition: unknown petition",
		],
		["bad id", { ...decree("a"), id: "Bad Id" }, "decree.id:"],
		[
			"missing otherwise",
			{ id: "a", petition: "harvest", rules: [] },
			"decree.otherwise: is missing",
		],
		["unknown key", { ...decree("a"), extra: 1 }, "decree.extra: unknown key"],
		[
			"unknown quantity",
			withRule({
				kind: "compare",
				quantity: "gold",
				comparison: "above",
				value: 1,
			}),
			'decree.rules[0].when.quantity: unknown quantity "gold"',
		],
		[
			"unknown condition kind",
			withRule({ kind: "maybe" }),
			"decree.rules[0].when.kind: unknown condition kind",
		],
		[
			"non-finite value",
			withRule({
				kind: "compare",
				quantity: "coin",
				comparison: "below",
				value: Number.NaN,
			}),
			"decree.rules[0].when.value:",
		],
		[
			"empty all",
			withRule({ kind: "all", conditions: [] }),
			"decree.rules[0].when.conditions:",
		],
		[
			"bad nested path",
			withRule({
				kind: "not",
				condition: { kind: "season", season: "monsoon" },
			}),
			"decree.rules[0].when.condition.season:",
		],
	])("rejects %s with the path of the bad value", (_name, input, prefix) => {
		expect(rejection(() => parseDecree(input, limits))).toStartWith(prefix);
	});

	test("accepts exactly maxRules rules and rejects one more", () => {
		const rule = { when: winter, policy: "feed" };

		expect(() =>
			parseDecree({ ...decree("a"), rules: [rule, rule] }, limits),
		).not.toThrow();
		expect(
			rejection(() =>
				parseDecree({ ...decree("a"), rules: [rule, rule, rule] }, limits),
			),
		).toStartWith("decree.rules:");
	});

	test("accepts a condition tree of exactly maxConditionNodes and rejects one more", () => {
		const four: Condition = {
			kind: "all",
			conditions: [winter, winter, winter],
		};
		const five: Condition = {
			kind: "all",
			conditions: [winter, winter, winter, winter],
		};

		expect(() => parseDecree(decree("a", four), limits)).not.toThrow();
		expect(rejection(() => parseDecree(decree("a", five), limits))).toStartWith(
			"decree.rules[0].when.conditions[3]:",
		);
	});

	test("counts condition nodes per rule, not across the decree", () => {
		const four: Condition = {
			kind: "all",
			conditions: [winter, winter, winter],
		};
		const input = {
			...decree("a"),
			rules: [
				{ when: four, policy: "x" },
				{ when: four, policy: "y" },
			],
		};

		expect(() => parseDecree(input, limits)).not.toThrow();
	});

	test("accepts a condition tree of exactly maxConditionDepth and rejects one more", () => {
		const three: Condition = {
			kind: "not",
			condition: { kind: "not", condition: winter },
		};
		const four: Condition = { kind: "not", condition: three };

		expect(() =>
			parseDecree(decree("a", three), { ...limits, maxConditionNodes: 9 }),
		).not.toThrow();
		expect(
			rejection(() =>
				parseDecree(decree("a", four), { ...limits, maxConditionNodes: 9 }),
			),
		).toStartWith("decree.rules[0].when.condition.condition.condition:");
	});
});

describe("parseCondition", () => {
	test("reports errors under the path it was given", () => {
		const message = rejection(() =>
			parseCondition(
				{ kind: "season", season: "monsoon" },
				limits,
				"strategy.reactions[2].when",
			),
		);

		expect(message).toStartWith("strategy.reactions[2].when.season:");
	});

	test("returns a copy that shares nothing with the input", () => {
		const input: Condition = {
			kind: "not",
			condition: { kind: "season", season: "winter" },
		};

		const parsed = parseCondition(input, limits, "when");
		if (input.kind === "not" && input.condition.kind === "season")
			input.condition.season = "spring";

		expect(parsed).toEqual({ kind: "not", condition: winter });
	});
});

describe("decreeReferences", () => {
	test("collects nested chose ids once each, sorted", () => {
		const when: Condition = {
			kind: "any",
			conditions: [
				chose("zeta"),
				{ kind: "not", condition: chose("alpha") },
				chose("zeta"),
			],
		};

		expect(decreeReferences(decree("a", when))).toEqual(["alpha", "zeta"]);
	});

	test("is empty for a decree without chose conditions", () => {
		expect(decreeReferences(decree("a", winter))).toEqual([]);
	});
});

describe("orderDecrees", () => {
	test("places a dependency before its dependent", () => {
		const result = orderDecrees(records(decree("a", chose("z")), decree("z")));

		expect(result).toEqual({ ok: true, order: ["z", "a"] });
	});

	test("orders independent decrees by id", () => {
		const result = orderDecrees(records(decree("c"), decree("a"), decree("b")));

		expect(result).toEqual({ ok: true, order: ["a", "b", "c"] });
	});

	test("gives the same order regardless of insertion order", () => {
		const entries = [
			decree("m", chose("b")),
			decree("b"),
			decree("a"),
			decree("z", chose("m")),
		];

		const forward = orderDecrees(records(...entries));
		const backward = orderDecrees(records(...[...entries].reverse()));

		expect(backward).toEqual(forward);
		expect(forward).toEqual({ ok: true, order: ["a", "b", "m", "z"] });
	});

	test("ignores a reference to an id that is not in the record", () => {
		const result = orderDecrees(records(decree("a", chose("ghost"))));

		expect(result).toEqual({ ok: true, order: ["a"] });
	});

	test("reports a self-reference as a cycle of one", () => {
		const result = orderDecrees(records(decree("a", chose("a"))));

		expect(result).toEqual({ ok: false, cycle: ["a"] });
	});

	test("reports a genuine cycle containing only cycle members", () => {
		const all = records(
			decree("aa"),
			decree("a", chose("b")),
			decree("b", {
				kind: "all",
				conditions: [chose("aa"), chose("c")],
			}),
			decree("c", chose("d")),
			decree("d", chose("b")),
		);

		const result = orderDecrees(all);

		if (result.ok) throw new Error("expected a cycle");
		expect([...result.cycle].sort()).toEqual(["b", "c", "d"]);
		result.cycle.forEach((id, index) => {
			const next = result.cycle[(index + 1) % result.cycle.length] as string;
			expect(decreeReferences(all[id] as Decree)).toContain(next);
		});
	});
});
