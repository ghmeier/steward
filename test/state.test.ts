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

	test("returns different rng streams for different seeds", () => {
		const first = createNewGame(1, tuning);

		const second = createNewGame(2, tuning);

		expect(second.posting.rng).not.toEqual(first.posting.rng);
	});

	test("produces a state that passes validation", () => {
		const state = createNewGame(7, tuning);

		expect(validateState(state)).toEqual([]);
	});

	test("starts at tick zero with tuned toy values and one seeded stream per name", () => {
		const state = createNewGame(7, tuning);

		expect(state.schemaVersion).toBe(SCHEMA_VERSION);
		expect(state.tick).toBe(0);
		expect(state.posting.resources).toEqual({ [tuning.toy.resource]: 0 });
		expect(state.posting.toy.growthPerTick).toBe(
			tuning.toy.initialGrowthPerTick,
		);
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

	test("rejects a negative maxLoss", () => {
		const bad = { ...tuningJson, toy: { ...tuningJson.toy, maxLoss: -1 } };

		expect(() => parseTuning(bad)).toThrow("maxLoss");
	});

	test("rejects a non-integer lossChancePerMille", () => {
		const bad = {
			...tuningJson,
			toy: { ...tuningJson.toy, lossChancePerMille: 20.5 },
		};

		expect(() => parseTuning(bad)).toThrow("lossChancePerMille");
	});

	test("accepts an integer lossChancePerMille at both bounds", () => {
		for (const lossChancePerMille of [0, 1000]) {
			const ok = {
				...tuningJson,
				toy: { ...tuningJson.toy, lossChancePerMille },
			};

			expect(parseTuning(ok).toy.lossChancePerMille).toBe(lossChancePerMille);
		}
	});
});
