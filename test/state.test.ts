import { describe, expect, test } from "bun:test";
import tuningJson from "../data/tuning.json";
import villageJson from "../data/village.json";
import { seedStream } from "../src/core/rng";
import { createNewGame, RNG_STREAMS, SCHEMA_VERSION } from "../src/core/state";
import { parseTuning } from "../src/core/tuning";
import { validateState } from "../src/core/validate";
import { tuning } from "./helpers";

const fullTuningJson = { ...tuningJson, village: villageJson };

describe("createNewGame", () => {
	test("returns deeply equal states for the same seed", () => {
		const first = createNewGame(42, tuning);

		const second = createNewGame(42, tuning);

		expect(second).toEqual(first);
	});

	test("produces a state that passes validation", () => {
		const state = createNewGame(7, tuning);

		expect(validateState(state)).toEqual([]);
	});

	test("starts with the tuned resources and population and an idle village", () => {
		const state = createNewGame(7, tuning);

		expect(state.schemaVersion).toBe(SCHEMA_VERSION);
		expect(state.tick).toBe(0);
		expect(state.posting.resources).toEqual(tuning.economy.initialResources);
		expect(state.posting.economy).toEqual({
			hunger: 0,
			growth: 0,
			starved: 0,
		});
		expect(Object.keys(state.posting.rng)).toEqual([...RNG_STREAMS]);
		expect(state.posting.nextDelegateId).toBe(
			tuning.economy.initialPopulation + 1,
		);
	});

	test("seeds every stream from the seed and its name when nobody is born", () => {
		const empty = {
			...tuning,
			economy: { ...tuning.economy, initialPopulation: 0 },
		};

		const state = createNewGame(7, empty);

		// The disputes stream has already drawn the first arrival delay.
		for (const name of RNG_STREAMS.filter((name) => name !== "disputes")) {
			expect(state.posting.rng[name]).toEqual(seedStream(7, name));
		}
	});

	test("accepts the uint32 boundary seeds", () => {
		expect(() => createNewGame(0, tuning)).not.toThrow();
		expect(() => createNewGame(0xffffffff, tuning)).not.toThrow();
	});

	test.each([-1, 1.5, 0x100000000, Number.NaN, Number.POSITIVE_INFINITY])(
		"rejects the non-uint32 seed %p",
		(seed) => {
			expect(() => createNewGame(seed, tuning)).toThrow();
		},
	);
});

describe("parseTuning", () => {
	test("accepts data/tuning.json", () => {
		expect(parseTuning(fullTuningJson) as unknown).toEqual(fullTuningJson);
	});

	test("rejects a missing field and names it", () => {
		const { stepMs: _omitted, ...rest } = fullTuningJson;

		expect(() => parseTuning(rest)).toThrow("stepMs");
	});

	test.each([
		["ticksPerSeason", 0, "ticksPerSeason"],
		["ticksPerSeason", 1.5, "ticksPerSeason"],
		["maxPopulation", -1, "maxPopulation"],
		["initialPopulation", 41, "initialPopulation"],
		["starvationHunger", 0, "starvationHunger"],
		["grainPerPeasant", 0, "grainPerPeasant"],
		["grainPrice", -0.5, "grainPrice"],
		["woodPrice", -0.5, "woodPrice"],
		["orePrice", -1, "orePrice"],
		["laborMovesPerTick", 0, "laborMovesPerTick"],
	])("rejects economy.%s of %p and names the field", (key, value, named) => {
		const bad = {
			...fullTuningJson,
			economy: { ...tuningJson.economy, [key]: value },
		};

		expect(() => parseTuning(bad)).toThrow(named);
	});

	test("accepts an initial population equal to the maximum", () => {
		const ok = {
			...fullTuningJson,
			economy: { ...tuningJson.economy, initialPopulation: 40 },
		};

		expect(parseTuning(ok).economy.initialPopulation).toBe(40);
	});

	test("rejects a season yield missing a season", () => {
		const { winter: _omitted, ...seasonYield } = tuningJson.economy.seasonYield;
		const bad = {
			...fullTuningJson,
			economy: { ...tuningJson.economy, seasonYield },
		};

		expect(() => parseTuning(bad)).toThrow("seasonYield");
	});

	test("rejects initial resources with an unknown resource", () => {
		const bad = {
			...fullTuningJson,
			economy: {
				...tuningJson.economy,
				initialResources: { ...tuningJson.economy.initialResources, gold: 1 },
			},
		};

		expect(() => parseTuning(bad)).toThrow("initialResources");
	});

	test.each([
		["no allocations", {}],
		[
			"shares that do not sum to 1",
			{ odd: { farm: 0.5, forest: 0.5, mine: 0.5 } },
		],
		["a negative share", { odd: { farm: 1.5, forest: -0.5, mine: 0 } }],
		["a missing job", { odd: { farm: 0.5, forest: 0.5 } }],
	])("rejects laborAllocations with %s", (_name, laborAllocations) => {
		const bad = {
			...fullTuningJson,
			economy: { ...tuningJson.economy, laborAllocations },
		};

		expect(() => parseTuning(bad)).toThrow("laborAllocations");
	});
});

describe("parseTuning village names", () => {
	const withNames = (names: unknown) => ({
		...fullTuningJson,
		village: { ...villageJson, names },
	});

	test("rejects a name list shorter than the maximum population", () => {
		const names = villageJson.names.slice(
			0,
			tuningJson.economy.maxPopulation - 1,
		);

		expect(() => parseTuning(withNames(names))).toThrow("maxPopulation");
	});

	test("accepts a name list exactly as long as the maximum population", () => {
		const names = villageJson.names.slice(0, tuningJson.economy.maxPopulation);

		expect(parseTuning(withNames(names)).village.names).toEqual(names);
	});

	test("rejects an empty name", () => {
		const names = [...villageJson.names];
		names[3] = "";

		expect(() => parseTuning(withNames(names))).toThrow("non-empty");
	});

	test("rejects a repeated name", () => {
		const names = [...villageJson.names];
		names[5] = names[2] as string;

		expect(() => parseTuning(withNames(names))).toThrow("repeats");
	});

	test("rejects a missing village section", () => {
		expect(() => parseTuning(tuningJson)).toThrow("village");
	});
});
