import { describe, expect, test } from "bun:test";
import { seedStream } from "../src/core/rng";
import { createNewGame, RNG_STREAMS, SCHEMA_VERSION } from "../src/core/state";
import { parseTuning } from "../src/core/tuning";
import { validateState } from "../src/core/validate";
import { fullTuningJson, tuning } from "./helpers";

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
			famine: { startPopulation: 0, ticks: 0, deaths: 0 },
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
	test("accepts data/tuning.json unchanged", () => {
		expect(parseTuning(fullTuningJson) as unknown).toEqual(fullTuningJson);
	});

	// biome-ignore lint/suspicious/noExplicitAny: the table mutates arbitrary JSON paths
	type Json = Record<string, any>;

	const crossFieldRejections: [string, (json: Json) => void, string][] = [
		[
			"initial population above the maximum",
			(j) => {
				j.economy.initialPopulation = j.economy.maxPopulation + 1;
			},
			"tuning.economy.initialPopulation: must not exceed",
		],
		[
			"allocation shares that do not sum to 1",
			(j) => {
				j.economy.laborAllocations = {
					odd: { farm: 0.5, forest: 0.5, mine: 0.5 },
				};
			},
			"tuning.economy.laborAllocations.odd: shares must sum to 1",
		],
		[
			"fewer names than the maximum population",
			(j) => {
				j.village.names = j.village.names.slice(0, j.economy.maxPopulation - 1);
			},
			"tuning.village.names: needs at least",
		],
		[
			"a repeated name",
			(j) => {
				j.village.names[5] = j.village.names[2];
			},
			"tuning.village.names: repeats",
		],
		[
			"a promotion population above the maximum",
			(j) => {
				j.village.promotionPopulation = j.economy.maxPopulation + 1;
			},
			"tuning.village.promotionPopulation: must not exceed",
		],
		[
			"minTicks above maxTicks",
			(j) => {
				j.village.disputeArrival = { minTicks: 20, maxTicks: 10 };
			},
			"tuning.village.disputeArrival.minTicks: must not exceed",
		],
		[
			"a repeated dispute id",
			(j) => {
				j.village.disputes[1].id = j.village.disputes[0].id;
			},
			"tuning.village.disputes: repeats id",
		],
		[
			"a repeated option id",
			(j) => {
				j.village.disputes[0].options[1].id =
					j.village.disputes[0].options[0].id;
			},
			"tuning.village.disputes[0].options: repeats option id",
		],
		[
			"an expiry naming no option",
			(j) => {
				j.village.disputes[0].expiry = "nothing";
			},
			"tuning.village.disputes[0].expiry: must name one of its options",
		],
		[
			"an unknown placeholder",
			(j) => {
				j.village.disputes[0].text = "{third} waits";
			},
			"tuning.village.disputes[0].text: has unknown placeholder",
		],
		[
			"an expiry option that grudges",
			(j) => {
				const [dispute] = j.village.disputes;
				dispute.options.find(
					(o: { id: string }) => o.id === dispute.expiry,
				).grudge = "first";
			},
			"must not grudge",
		],
		[
			"an expiry option that gains a resource",
			(j) => {
				const [dispute] = j.village.disputes;
				dispute.options.find(
					(o: { id: string }) => o.id === dispute.expiry,
				).resources = { coin: 1 };
			},
			"must not gain coin",
		],
		[
			"no compound conditions entry",
			(j) => {
				j.archive.entries = j.archive.entries.filter(
					(e: { id: string }) => e.id !== "decree.compound",
				);
			},
			'tuning.archive.entries: must include "decree.compound"',
		],
		[
			"no chaining entry",
			(j) => {
				j.archive.entries = j.archive.entries.filter(
					(e: { id: string }) => e.id !== "decree.chaining",
				);
			},
			'tuning.archive.entries: must include "decree.chaining"',
		],
		[
			"a duplicate id across entries",
			(j) => {
				j.archive.entries[1].id = j.archive.entries[0].id;
			},
			"tuning.archive: repeats id",
		],
		[
			"a requires naming an unknown id",
			(j) => {
				j.archive.entries[0].requires = ["control.nothing"];
			},
			'requires unknown id "control.nothing"',
		],
		[
			"a requires cycle",
			(j) => {
				j.archive.entries[0].requires = ["control.savedDecrees"];
			},
			"tuning.archive.entries: requires cycle",
		],
		[
			"no Archive panel play unlock",
			(j) => {
				j.archive.play = [];
			},
			"tuning.archive.play: must include",
		],
		[
			"a repeated need hook control",
			(j) => {
				j.archive.needs[1].control = j.archive.needs[0].control;
			},
			"tuning.archive.needs: repeats control",
		],
	];

	test.each(crossFieldRejections)("rejects %s", (_name, change, fragment) => {
		const json = structuredClone(fullTuningJson) as Json;
		change(json);

		expect(() => parseTuning(json)).toThrow(fragment);
	});
});
