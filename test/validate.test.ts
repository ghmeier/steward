import { describe, expect, test } from "bun:test";
import { createNewGame, SCHEMA_VERSION } from "../src/core/state";
import { assertValidState, validateState } from "../src/core/validate";
import { tuning } from "./helpers";

type Tree = Record<string, unknown>;

function freshGame(): Tree {
	return createNewGame(5, tuning) as unknown as Tree;
}

function setAt(root: Tree, path: string[], value: unknown): void {
	let node = root;
	for (const key of path.slice(0, -1)) node = node[key] as Tree;
	node[path[path.length - 1] as string] = value;
}

class Widget {
	size = 1;
}

describe("validateState", () => {
	test("reports no problems for a fresh game", () => {
		expect(validateState(freshGame())).toEqual([]);
	});

	const forbidden: [string, () => unknown][] = [
		["undefined", () => undefined],
		["null", () => null],
		["NaN", () => Number.NaN],
		["Infinity", () => Number.POSITIVE_INFINITY],
		["negative zero", () => -0],
		["a Map", () => new Map()],
		["a Set", () => new Set()],
		["a Date", () => new Date(0)],
		["a class instance", () => new Widget()],
		["a function", () => () => 1],
	];

	test.each(forbidden)("reports %s with its path", (_name, make) => {
		const state = freshGame();
		setAt(state, ["posting", "resources", "grain"], make());

		const problems = validateState(state);

		expect(
			problems.some((p) => p.startsWith("$.posting.resources.grain")),
		).toBe(true);
	});

	test("reports a forbidden value nested inside an array with its index", () => {
		const state = freshGame();
		setAt(state, ["career", "followers"], ["ok", undefined]);

		const problems = validateState(state);

		expect(problems.some((p) => p.startsWith("$.career.followers[1]"))).toBe(
			true,
		);
	});

	test("reports a sparse array hole", () => {
		const state = freshGame();
		// biome-ignore lint/suspicious/noSparseArray: the hole is the point of the test
		setAt(state, ["career", "followers"], ["a", , "c"]);

		const problems = validateState(state);

		expect(problems.some((p) => p.includes("$.career.followers[1]"))).toBe(
			true,
		);
	});

	test("accepts an object with a null prototype", () => {
		const state = freshGame();
		setAt(
			state,
			["career", "unlocks"],
			Object.assign(Object.create(null), { a: 1 }),
		);

		expect(validateState(state)).toEqual([]);
	});

	test("reports a wrong schemaVersion", () => {
		const state = freshGame();
		setAt(state, ["schemaVersion"], SCHEMA_VERSION + 1);

		expect(validateState(state).join("\n")).toContain("$.schemaVersion");
	});

	test("reports a negative tick", () => {
		const state = freshGame();
		setAt(state, ["tick"], -1);

		expect(validateState(state).join("\n")).toContain("$.tick");
	});

	test("reports a fractional tick", () => {
		const state = freshGame();
		setAt(state, ["tick"], 1.5);

		expect(validateState(state).join("\n")).toContain("$.tick");
	});

	test("reports an all-zero rng stream", () => {
		const state = freshGame();
		setAt(state, ["posting", "rng", "toy"], [0, 0, 0, 0]);

		expect(validateState(state).join("\n")).toContain("$.posting.rng.toy");
	});

	test("reports an rng stream with five words", () => {
		const state = freshGame();
		setAt(state, ["posting", "rng", "toy"], [1, 2, 3, 4, 5]);

		expect(validateState(state).join("\n")).toContain("$.posting.rng.toy");
	});

	test("reports a seed that is not a uint32", () => {
		const state = freshGame();
		setAt(state, ["posting", "seed"], 2 ** 32);

		expect(validateState(state).join("\n")).toContain("$.posting.seed");
	});

	test("reports career fields with the wrong container type", () => {
		const state = freshGame();
		setAt(state, ["career", "followers"], {});
		setAt(state, ["career", "unlocks"], []);

		const text = validateState(state).join("\n");

		expect(text).toContain("$.career.followers");
		expect(text).toContain("$.career.unlocks");
	});
});

describe("validateState decrees", () => {
	const granary = {
		id: "granary",
		petition: "harvest",
		rules: [],
		otherwise: "sell",
	};

	test("accepts a well-formed decree stored under its id", () => {
		const state = freshGame();
		setAt(state, ["posting", "decrees"], { granary });

		expect(validateState(state)).toEqual([]);
	});

	test("reports a decree stored under a key that differs from its id", () => {
		const state = freshGame();
		setAt(state, ["posting", "decrees"], { market: granary });

		expect(validateState(state)).toEqual([
			"$.posting.decrees.market: id must equal its key",
		]);
	});

	test("reports a malformed decree with its parse error", () => {
		const state = freshGame();
		setAt(state, ["posting", "decrees"], {
			granary: { ...granary, petition: "tax" },
		});

		expect(validateState(state).join("\n")).toContain(
			"$.posting.decrees.granary: decree.petition",
		);
	});

	test("reports decrees that are not an object", () => {
		const state = freshGame();
		setAt(state, ["posting", "decrees"], []);

		expect(validateState(state)).toEqual([
			"$.posting.decrees: must be an object",
		]);
	});

	test("reports a set whose decrees form a cycle", () => {
		const state = freshGame();
		const chose = (decree: string, policy: string) => ({
			kind: "chose",
			decree,
			policy,
		});
		setAt(state, ["posting", "decrees"], {
			a: {
				...granary,
				id: "a",
				rules: [{ when: chose("b", "farming"), policy: "sell" }],
			},
			b: {
				id: "b",
				petition: "labor",
				rules: [{ when: chose("a", "sell"), policy: "farming" }],
				otherwise: "balanced",
			},
		});

		expect(validateState(state)).toEqual([
			"$.posting.decrees: decree cycle: a -> b -> a",
		]);
	});

	test("reports a harvest decree with an unknown policy", () => {
		const state = freshGame();
		setAt(state, ["posting", "decrees"], {
			granary: { ...granary, otherwise: "tax" },
		});

		expect(validateState(state)).toEqual([
			'$.posting.decrees: decree "granary": policy "tax" is not a harvest policy',
		]);
	});

	test("reports only the parse error when a malformed decree sits beside a cyclic pair", () => {
		const state = freshGame();
		const chose = (decree: string, policy: string) => ({
			kind: "chose",
			decree,
			policy,
		});
		setAt(state, ["posting", "decrees"], {
			a: {
				...granary,
				id: "a",
				rules: [{ when: chose("b", "farming"), policy: "sell" }],
			},
			b: {
				id: "b",
				petition: "labor",
				rules: [{ when: chose("a", "sell"), policy: "farming" }],
				otherwise: "balanced",
			},
			bad: { ...granary, id: "bad", petition: "tax" },
		});

		expect(validateState(state)).toEqual([
			'$.posting.decrees.bad: decree.petition: unknown petition "tax"',
		]);
	});

	test("reports two decrees on the same petition", () => {
		const state = freshGame();
		setAt(state, ["posting", "decrees"], {
			granary,
			market: { ...granary, id: "market" },
		});

		expect(validateState(state)).toEqual([
			'$.posting.decrees: decree "granary" already handles the harvest petition',
		]);
	});
});

describe("validateState economy", () => {
	test.each([
		[
			"a missing economy",
			["posting", "economy"],
			undefined,
			"$.posting.economy",
		],
		[
			"a fractional population",
			["posting", "economy", "population"],
			1.5,
			"population",
		],
		[
			"a negative starved count",
			["posting", "economy", "starved"],
			-1,
			"starved",
		],
		[
			"a fractional labor count",
			["posting", "economy", "labor", "farm"],
			0.5,
			"labor.farm",
		],
		["negative hunger", ["posting", "economy", "hunger"], -1, "hunger"],
		[
			"infinite growth",
			["posting", "economy", "growth"],
			Number.POSITIVE_INFINITY,
			"growth",
		],
		["a missing resource", ["posting", "resources", "wood"], undefined, "wood"],
	])("reports %s", (_name, path, value, expected) => {
		const state = freshGame();
		if (value === undefined) {
			let node = state;
			for (const key of path.slice(0, -1)) node = node[key] as Tree;
			delete node[path[path.length - 1] as string];
		} else {
			setAt(state, path, value);
		}

		expect(validateState(state).join("\n")).toContain(expected);
	});

	test("reports labor that exceeds the population", () => {
		const state = freshGame();
		setAt(state, ["posting", "economy", "labor", "farm"], 11);

		expect(validateState(state).join("\n")).toContain("exceed population");
	});

	test("reports labor with an unknown job", () => {
		const state = freshGame();
		setAt(state, ["posting", "economy", "labor", "bank"], 0);

		expect(validateState(state).join("\n")).toContain(
			"$.posting.economy.labor",
		);
	});

	test("accepts a village whose workers equal the population", () => {
		const state = freshGame();
		setAt(state, ["posting", "economy", "labor", "farm"], 10);

		expect(validateState(state)).toEqual([]);
	});
});

describe("assertValidState", () => {
	test("accepts a fresh game", () => {
		expect(() => assertValidState(freshGame())).not.toThrow();
	});

	test("throws one error listing every problem", () => {
		const state = freshGame();
		setAt(state, ["tick"], -1);
		setAt(state, ["schemaVersion"], 99);

		expect(() => assertValidState(state)).toThrow(
			/\$\.tick[\s\S]*\$\.schemaVersion|\$\.schemaVersion[\s\S]*\$\.tick/,
		);
	});
});
