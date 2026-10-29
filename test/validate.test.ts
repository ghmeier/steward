import { describe, expect, test } from "bun:test";
import { createNewGame, SCHEMA_VERSION } from "../src/core/state";
import { assertValidState, validateState } from "../src/core/validate";
import { setRoster, tuning } from "./helpers";

type Tree = Record<string, unknown>;

function freshGame(peasants = 1): Tree {
	const state = createNewGame(5, tuning);
	setRoster(state, { idle: peasants });
	return state as unknown as Tree;
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

	test("reports a feed policy in a wood decree", () => {
		const state = freshGame();
		setAt(state, ["posting", "decrees"], {
			timber: { id: "timber", petition: "wood", rules: [], otherwise: "feed" },
		});

		expect(validateState(state)).toEqual([
			'$.posting.decrees: decree "timber": policy "feed" is not a wood policy',
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
			"a negative starved count",
			["posting", "economy", "starved"],
			-1,
			"starved",
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
});

describe("validateState delegates", () => {
	const delegateAt = (state: Tree, index: number) =>
		((state.posting as Tree).delegates as Tree[])[index] as Tree;

	test("accepts a roster with a worker, a grudge and gaps in the ids", () => {
		const state = freshGame(4);
		delegateAt(state, 2).job = "mine";
		delegateAt(state, 3).grudgeUntil = 40;
		(state.posting as Tree).delegates = [
			delegateAt(state, 0),
			delegateAt(state, 2),
			delegateAt(state, 3),
		];

		expect(validateState(state)).toEqual([]);
	});

	test("reports a duplicate id", () => {
		const state = freshGame(4);
		delegateAt(state, 1).id = delegateAt(state, 0).id;

		expect(validateState(state).join("\n")).toContain("strictly ascending");
	});

	test("reports ids that are out of order", () => {
		const state = freshGame(4);
		const delegates = (state.posting as Tree).delegates as Tree[];
		delegates.reverse();

		expect(validateState(state).join("\n")).toContain("strictly ascending");
	});

	test("reports an id that is not below nextDelegateId", () => {
		const state = freshGame();
		const last = tuning.economy.initialPopulation - 1;
		setAt(state, ["posting", "nextDelegateId"], delegateAt(state, last).id);

		expect(validateState(state).join("\n")).toContain("below nextDelegateId");
	});

	test("reports two living peasants who share a name", () => {
		const state = freshGame(4);
		delegateAt(state, 1).name = delegateAt(state, 0).name;

		expect(validateState(state).join("\n")).toContain("held by another");
	});

	test.each([
		["an empty name", "name", ""],
		["an unknown job", "job", "bank"],
		["a governor kind", "kind", "governor"],
		["a fractional grudge", "grudgeUntil", 1.5],
		["a negative grudge", "grudgeUntil", -1],
	])("reports %s", (_name, key, value) => {
		const state = freshGame();
		delegateAt(state, 0)[key] = value;

		expect(validateState(state).join("\n")).toContain(
			`$.posting.delegates[0].${key}`,
		);
	});

	test("reports a null anywhere in the roster", () => {
		const state = freshGame();
		delegateAt(state, 0).job = null;

		expect(validateState(state).join("\n")).toContain(
			"$.posting.delegates[0].job: null is not allowed",
		);
	});

	test("reports a missing roster", () => {
		const state = freshGame();
		delete (state.posting as Tree).delegates;

		expect(validateState(state).join("\n")).toContain("$.posting.delegates");
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

describe("promotedAt validation", () => {
	test.each([
		["negative", -1, 10],
		["fractional", 1.5, 10],
		["later than the current tick", 11, 10],
	])("rejects a promotedAt that is %s", (_name, promotedAt, tick) => {
		const state = freshGame();
		state.tick = tick;
		setAt(state, ["career", "promotedAt"], promotedAt);

		const problems = validateState(state);

		expect(problems.some((p) => p.startsWith("$.career.promotedAt"))).toBe(
			true,
		);
	});

	test("accepts a promotedAt equal to the current tick", () => {
		const state = freshGame();
		state.tick = 10;
		setAt(state, ["career", "promotedAt"], 10);

		expect(validateState(state)).toEqual([]);
	});
});
