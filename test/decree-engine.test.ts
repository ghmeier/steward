import { describe, expect, test } from "bun:test";
import type { Condition, Petition } from "../src/core/decree";
import {
	enactDecree,
	evaluateCondition,
	policiesFor,
	quantityValue,
	repealDecree,
	runDecrees,
} from "../src/core/decree-engine";
import type { AddContext } from "../src/core/math";
import { createNewGame } from "../src/core/state";
import { economyTestTuning as tuning } from "./helpers";

const context: AddContext = { tick: 1, maxValue: 1e300, absorbed: null };

function freshState() {
	return createNewGame(1, tuning);
}

function above(value: number): Condition {
	return {
		kind: "compare",
		quantity: "grainSeasons",
		comparison: "above",
		value,
	};
}

function chose(decree: string, policy: string): Condition {
	return { kind: "chose", decree, policy };
}

function decreeOf(
	id: string,
	petition: Petition,
	rules: { when: Condition; policy: string }[],
	otherwise: string,
) {
	return { id, petition, rules, otherwise };
}

function harvest(
	id: string,
	rules: { when: Condition; policy: string }[] = [],
	otherwise = "stockpile",
) {
	return decreeOf(id, "harvest", rules, otherwise);
}

function labor(
	id: string,
	rules: { when: Condition; policy: string }[] = [],
	otherwise = "balanced",
) {
	return decreeOf(id, "labor", rules, otherwise);
}

function enactOk(state: ReturnType<typeof freshState>, value: unknown) {
	expect(enactDecree(state, value, tuning)).toEqual({ ok: true });
}

describe("policiesFor", () => {
	test("lists the fixed harvest policies and the sorted tuned labor allocations", () => {
		expect(policiesFor("harvest", tuning)).toEqual([
			"feed",
			"sell",
			"stockpile",
		]);
		expect(policiesFor("labor", tuning)).toEqual(["balanced", "farming"]);
	});
});

describe("enactDecree", () => {
	test("stores an accepted decree under its id", () => {
		const state = freshState();
		const decree = harvest("granary", [{ when: above(3), policy: "sell" }]);

		enactOk(state, decree);

		expect(state.posting.decrees).toEqual({ granary: decree });
	});

	test("keeps no reference to the object it was given", () => {
		const state = freshState();
		const decree = harvest("granary", [{ when: above(3), policy: "sell" }]);
		enactOk(state, decree);

		decree.otherwise = "sell";
		decree.rules.length = 0;

		expect(state.posting.decrees.granary?.otherwise).toBe("stockpile");
		expect(state.posting.decrees.granary?.rules).toHaveLength(1);
	});

	const rejections: [string, unknown, RegExp][] = [
		["a malformed decree", { id: "granary" }, /decree\.otherwise: is missing/],
		[
			"a rule policy of the wrong petition",
			harvest("granary", [{ when: above(1), policy: "farming" }]),
			/^decree "granary": policy "farming" is not a harvest policy$/,
		],
		[
			"an otherwise policy of the wrong petition",
			labor("crew", [], "sell"),
			/^decree "crew": policy "sell" is not a labor policy$/,
		],
		[
			"a petition another decree already handles",
			harvest("market"),
			/^decree "granary" already handles the harvest petition$/,
		],
		[
			"a reference to an unknown decree",
			labor("crew", [{ when: chose("ghost", "sell"), policy: "farming" }]),
			/^decree "crew" references unknown decree "ghost"$/,
		],
		[
			"a chose test for a policy the target cannot choose",
			labor("crew", [{ when: chose("granary", "farming"), policy: "farming" }]),
			/^decree "crew" tests for policy "farming", which decree "granary" cannot choose$/,
		],
	];

	test.each(rejections)(
		"rejects %s and leaves the active decrees alone",
		(_name, value, reason) => {
			const state = freshState();
			enactOk(state, harvest("granary"));
			const before = structuredClone(state.posting.decrees);

			const result = enactDecree(state, value, tuning);

			expect(result.ok).toBe(false);
			expect(result.ok ? "" : result.reason).toMatch(reason);
			expect(state.posting.decrees).toEqual(before);
		},
	);

	test("rejects a decree over the size limits", () => {
		const state = freshState();
		const rules = Array.from({ length: tuning.decrees.maxRules + 1 }, () => ({
			when: above(1),
			policy: "sell",
		}));

		const result = enactDecree(state, harvest("granary", rules), tuning);

		expect(result).toEqual({
			ok: false,
			reason: `decree.rules: has more than ${tuning.decrees.maxRules} rules`,
		});
		expect(state.posting.decrees).toEqual({});
	});

	test("rejects a cycle, names it, and leaves the active decrees unchanged", () => {
		const state = freshState();
		enactOk(state, harvest("granary"));
		enactOk(
			state,
			labor("a-workforce", [
				{ when: chose("granary", "stockpile"), policy: "farming" },
			]),
		);
		const before = structuredClone(state.posting.decrees);

		const result = enactDecree(
			state,
			harvest("granary", [
				{ when: chose("a-workforce", "balanced"), policy: "stockpile" },
			]),
			tuning,
		);

		expect(result).toEqual({
			ok: false,
			reason: "decree cycle: a-workforce -> granary -> a-workforce",
		});
		expect(state.posting.decrees).toEqual(before);
	});

	test("replaces an active decree that has the same id", () => {
		const state = freshState();
		enactOk(state, harvest("granary"));

		enactOk(state, harvest("granary", [], "sell"));

		expect(Object.keys(state.posting.decrees)).toEqual(["granary"]);
		expect(state.posting.decrees.granary?.otherwise).toBe("sell");
	});

	test("rejects replacing a referenced decree with one on a different petition", () => {
		const state = freshState();
		enactOk(state, harvest("granary"));
		enactOk(
			state,
			labor("crew", [{ when: chose("granary", "sell"), policy: "farming" }]),
		);
		const before = structuredClone(state.posting.decrees);

		const result = enactDecree(state, labor("granary"), tuning);

		expect(result).toEqual({
			ok: false,
			reason: 'decree "crew" already handles the labor petition',
		});
		expect(state.posting.decrees).toEqual(before);
	});

	test("rejects a decree that tests its own choice, as a one-decree cycle", () => {
		const state = freshState();

		const result = enactDecree(
			state,
			harvest("granary", [{ when: chose("granary", "sell"), policy: "sell" }]),
			tuning,
		);

		expect(result).toEqual({
			ok: false,
			reason: "decree cycle: granary -> granary",
		});
		expect(state.posting.decrees).toEqual({});
	});
});

describe("repealDecree", () => {
	test("removes an unreferenced decree", () => {
		const state = freshState();
		enactOk(state, harvest("granary"));

		expect(repealDecree(state, "granary")).toEqual({ ok: true });

		expect(state.posting.decrees).toEqual({});
	});

	test("rejects an unknown id, including names inherited from Object", () => {
		const state = freshState();

		expect(repealDecree(state, "ghost")).toEqual({
			ok: false,
			reason: 'no active decree "ghost"',
		});
		expect(repealDecree(state, "constructor")).toEqual({
			ok: false,
			reason: 'no active decree "constructor"',
		});
	});

	test("rejects repealing a decree another decree references", () => {
		const state = freshState();
		enactOk(state, harvest("granary"));
		enactOk(
			state,
			labor("crew", [{ when: chose("granary", "sell"), policy: "farming" }]),
		);

		const result = repealDecree(state, "granary");

		expect(result).toEqual({
			ok: false,
			reason: 'decree "crew" references "granary"',
		});
		expect(Object.keys(state.posting.decrees).sort()).toEqual([
			"crew",
			"granary",
		]);
	});
});

describe("quantityValue", () => {
	test("reads each quantity from the state", () => {
		const state = freshState();
		state.posting.economy.labor.farm = 3;

		expect(quantityValue("grain", state, tuning)).toBe(60);
		expect(quantityValue("coin", state, tuning)).toBe(0);
		expect(quantityValue("population", state, tuning)).toBe(10);
		expect(quantityValue("idle", state, tuning)).toBe(7);
		// 60 grain over 10 people eating 0.01 for 600 ticks.
		expect(quantityValue("grainSeasons", state, tuning)).toBe(1);
	});
});

describe("evaluateCondition", () => {
	const check = (condition: Condition, chosen: Record<string, string> = {}) =>
		evaluateCondition(condition, freshState(), tuning, chosen);
	const compare = (
		comparison: "above" | "below",
		value: number,
	): Condition => ({
		kind: "compare",
		quantity: "grain",
		comparison,
		value,
	});

	test("above and below are strict at the boundary", () => {
		expect(check(compare("above", 60))).toBe(false);
		expect(check(compare("above", 59))).toBe(true);
		expect(check(compare("below", 60))).toBe(false);
		expect(check(compare("below", 61))).toBe(true);
	});

	test("season matches only the current season", () => {
		const state = freshState();
		state.tick = 601;
		const inSeason = (season: "spring" | "summer") =>
			evaluateCondition({ kind: "season", season }, state, tuning, {});

		expect(inSeason("summer")).toBe(true);
		expect(inSeason("spring")).toBe(false);
	});

	test("chose is true only for the policy a decree picked this tick", () => {
		expect(check(chose("granary", "sell"), { granary: "sell" })).toBe(true);
		expect(check(chose("granary", "feed"), { granary: "sell" })).toBe(false);
		expect(check(chose("granary", "sell"), {})).toBe(false);
		expect(check(chose("constructor", "sell"), {})).toBe(false);
	});

	test("all, any and not combine their children", () => {
		const yes = compare("above", 0);
		const no = compare("below", 0);

		expect(check({ kind: "all", conditions: [yes, yes] })).toBe(true);
		expect(check({ kind: "all", conditions: [yes, no] })).toBe(false);
		expect(check({ kind: "any", conditions: [no, yes] })).toBe(true);
		expect(check({ kind: "any", conditions: [no, no] })).toBe(false);
		expect(check({ kind: "not", condition: no })).toBe(true);
		expect(check({ kind: "not", condition: yes })).toBe(false);
	});
});

describe("runDecrees", () => {
	const surplus = { grainSurplus: 3 };

	test("changes nothing when no decree is active", () => {
		const state = freshState();
		const before = structuredClone(state);

		const chosen = runDecrees(state, tuning, context, surplus);

		expect(state).toEqual(before);
		expect(chosen).toEqual({});
	});

	test("sell turns the surplus into coin at the grain price", () => {
		const state = freshState();
		enactOk(state, harvest("granary", [], "sell"));

		runDecrees(state, tuning, context, surplus);

		expect(state.posting.resources.grain).toBe(57);
		expect(state.posting.resources.coin).toBe(1.5);
	});

	test("feed turns the surplus into growth", () => {
		const state = freshState();
		enactOk(state, harvest("granary", [], "feed"));

		runDecrees(state, tuning, context, surplus);

		expect(state.posting.resources.grain).toBe(57);
		expect(state.posting.economy.growth).toBe(3);
		expect(state.posting.resources.coin).toBe(0);
	});

	test("stockpile leaves the surplus in grain", () => {
		const state = freshState();
		enactOk(state, harvest("granary", [], "stockpile"));

		runDecrees(state, tuning, context, surplus);

		expect(state.posting.resources.grain).toBe(60);
		expect(state.posting.economy.growth).toBe(0);
	});

	test("the first matching rule wins over later rules", () => {
		const state = freshState();
		enactOk(
			state,
			harvest(
				"granary",
				[
					{ when: above(0.5), policy: "sell" },
					{ when: above(0.1), policy: "feed" },
				],
				"stockpile",
			),
		);

		const chosen = runDecrees(state, tuning, context, surplus);

		expect(chosen).toEqual({ granary: "sell" });
	});

	test("otherwise applies only when no rule matches", () => {
		const state = freshState();
		enactOk(
			state,
			harvest("granary", [{ when: above(5), policy: "sell" }], "feed"),
		);

		const chosen = runDecrees(state, tuning, context, surplus);

		expect(chosen).toEqual({ granary: "feed" });
	});

	test("a labor decree moves one peasant per tick toward its allocation", () => {
		const state = freshState();
		enactOk(state, labor("crew", [], "farming"));

		runDecrees(state, tuning, context, surplus);
		expect(state.posting.economy.labor).toEqual({
			farm: 1,
			forest: 0,
			mine: 0,
		});

		runDecrees(state, tuning, context, surplus);
		expect(state.posting.economy.labor).toEqual({
			farm: 2,
			forest: 0,
			mine: 0,
		});
	});

	describe("chaining", () => {
		// With five farmers, farming (7/2/1) adds a farmer and balanced (5/3/2) adds a forester.
		function chained(granaryOtherwise: string) {
			const state = freshState();
			state.posting.economy.labor.farm = 5;
			enactOk(state, harvest("granary", [], granaryOtherwise));
			enactOk(
				state,
				labor("a-workforce", [
					{ when: chose("granary", "sell"), policy: "farming" },
				]),
			);
			return state;
		}

		test("a decree sees the choice an earlier decree made in the same tick", () => {
			const state = chained("sell");

			const chosen = runDecrees(state, tuning, context, surplus);

			expect(chosen).toEqual({ "a-workforce": "farming", granary: "sell" });
			expect(state.posting.economy.labor.farm).toBe(6);
		});

		test("a different choice by the earlier decree changes the later outcome", () => {
			const state = chained("stockpile");

			const chosen = runDecrees(state, tuning, context, surplus);

			expect(chosen["a-workforce"]).toBe("balanced");
			expect(state.posting.economy.labor.forest).toBe(1);
		});
	});

	test("throws on a harvest policy the engine does not know", () => {
		const state = freshState();
		state.posting.decrees.granary = harvest("granary", [], "tax");

		expect(() => runDecrees(state, tuning, context, surplus)).toThrow(
			/unknown harvest policy "tax"/,
		);
	});

	test("throws when the active decrees form a cycle", () => {
		const state = freshState();
		state.posting.decrees = {
			a: harvest("a", [{ when: chose("b", "sell"), policy: "sell" }]),
			b: labor("b", [{ when: chose("a", "sell"), policy: "farming" }]),
		};

		expect(() => runDecrees(state, tuning, context, surplus)).toThrow(/cycle/);
	});
});
