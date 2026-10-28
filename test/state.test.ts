import { describe, expect, test } from "bun:test";
import tuningJson from "../data/tuning.json";
import { seedStream } from "../src/core/rng";
import { createNewGame, RNG_STREAMS, SCHEMA_VERSION } from "../src/core/state";
import { parseTuning } from "../src/core/tuning";
import { validateState } from "../src/core/validate";
import { tuning } from "./helpers";

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
			population: tuning.economy.initialPopulation,
			labor: { farm: 0, forest: 0, mine: 0 },
			hunger: 0,
			growth: 0,
			starved: 0,
		});
		expect(Object.keys(state.posting.rng)).toEqual([...RNG_STREAMS]);
		for (const name of RNG_STREAMS) {
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
		expect(parseTuning(tuningJson)).toEqual(tuningJson);
	});

	test("rejects a missing field and names it", () => {
		const { stepMs: _omitted, ...rest } = tuningJson;

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
		["laborMovesPerTick", 0, "laborMovesPerTick"],
	])("rejects economy.%s of %p and names the field", (key, value, named) => {
		const bad = {
			...tuningJson,
			economy: { ...tuningJson.economy, [key]: value },
		};

		expect(() => parseTuning(bad)).toThrow(named);
	});

	test("accepts an initial population equal to the maximum", () => {
		const ok = {
			...tuningJson,
			economy: { ...tuningJson.economy, initialPopulation: 40 },
		};

		expect(parseTuning(ok).economy.initialPopulation).toBe(40);
	});

	test("rejects a season yield missing a season", () => {
		const { winter: _omitted, ...seasonYield } = tuningJson.economy.seasonYield;
		const bad = {
			...tuningJson,
			economy: { ...tuningJson.economy, seasonYield },
		};

		expect(() => parseTuning(bad)).toThrow("seasonYield");
	});

	test("rejects initial resources with an unknown resource", () => {
		const bad = {
			...tuningJson,
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
			...tuningJson,
			economy: { ...tuningJson.economy, laborAllocations },
		};

		expect(() => parseTuning(bad)).toThrow("laborAllocations");
	});
});
