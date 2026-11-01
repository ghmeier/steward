import { describe, expect, test } from "bun:test";
import { seedStream } from "../src/core/rng";
import { createNewGame, RNG_STREAMS, SCHEMA_VERSION } from "../src/core/state";
import { parseTuning } from "../src/core/tuning";
import { validateState } from "../src/core/validate";
import { fullTuningJson, tuning } from "./helpers";

describe("createNewGame", () => {
	test("is deterministic, valid, and starts with the tuned resources and an idle village", () => {
		const state = createNewGame(7, tuning);

		expect(createNewGame(7, tuning)).toEqual(state);
		expect(validateState(state)).toEqual([]);
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

	test.each([
		[0, true],
		[0xffffffff, true],
		[-1, false],
		[1.5, false],
		[0x100000000, false],
		[Number.NaN, false],
	])("seed %p is accepted only if it is a uint32: %p", (seed, accepted) => {
		const create = () => createNewGame(seed, tuning);

		if (accepted) expect(create).not.toThrow();
		else expect(create).toThrow();
	});
});

describe("parseTuning", () => {
	test("accepts data/tuning.json unchanged", () => {
		expect(parseTuning(fullTuningJson) as unknown).toEqual(fullTuningJson);
	});

	const t = fullTuningJson;
	const [firstDispute] = t.village.disputes;
	const expiryIndex =
		firstDispute?.options.findIndex(
			(option) => option.id === firstDispute.expiry,
		) ?? -1;
	const entries = t.archive.entries;
	const without = (id: string) => entries.filter((entry) => entry.id !== id);

	// Each row sets one dotted path in a copy of the shipped tuning JSON.
	// biome-ignore format: one row per case
	const crossFieldRejections: [string, string, unknown, string][] = [
		["initial population above the maximum", "economy.initialPopulation", t.economy.maxPopulation + 1, "tuning.economy.initialPopulation: must not exceed"],
		["allocation shares that do not sum to 1", "economy.laborAllocations", { odd: { farm: 0.5, forest: 0.5, mine: 0.5 } }, "tuning.economy.laborAllocations.odd: shares must sum to 1"],
		["fewer names than the maximum population", "village.names", t.village.names.slice(0, t.economy.maxPopulation - 1), "tuning.village.names: needs at least"],
		["a repeated name", "village.names.5", t.village.names[2], "tuning.village.names: repeats"],
		["a promotion population above the maximum", "village.promotionPopulation", t.economy.maxPopulation + 1, "tuning.village.promotionPopulation: must not exceed"],
		["minTicks above maxTicks", "village.disputeArrival", { minTicks: 20, maxTicks: 10 }, "tuning.village.disputeArrival.minTicks: must not exceed"],
		["a repeated dispute id", "village.disputes.1.id", firstDispute?.id, "tuning.village.disputes: repeats id"],
		["a repeated option id", "village.disputes.0.options.1.id", firstDispute?.options[0]?.id, "tuning.village.disputes[0].options: repeats option id"],
		["an expiry naming no option", "village.disputes.0.expiry", "nothing", "tuning.village.disputes[0].expiry: must name one of its options"],
		["an unknown placeholder", "village.disputes.0.text", "{third} waits", "tuning.village.disputes[0].text: has unknown placeholder"],
		["an expiry option that grudges", `village.disputes.0.options.${expiryIndex}.grudge`, "first", "must not grudge"],
		["an expiry option that gains a resource", `village.disputes.0.options.${expiryIndex}.resources`, { coin: 1 }, "must not gain coin"],
		["no compound conditions entry", "archive.entries", without("decree.compound"), 'tuning.archive.entries: must include "decree.compound"'],
		["no chaining entry", "archive.entries", without("decree.chaining"), 'tuning.archive.entries: must include "decree.chaining"'],
		["a duplicate id across entries", "archive.entries.1.id", entries[0]?.id, "tuning.archive: repeats id"],
		["a requires naming an unknown id", "archive.entries.0.requires", ["control.nothing"], 'requires unknown id "control.nothing"'],
		["a requires cycle", "archive.entries.0.requires", ["control.savedDecrees"], "tuning.archive.entries: requires cycle"],
		["no Archive panel play unlock", "archive.play", [], "tuning.archive.play: must include"],
		["a repeated need hook control", "archive.needs.1.control", t.archive.needs[0]?.control, "tuning.archive.needs: repeats control"],
	];

	test.each(crossFieldRejections)(
		"rejects %s",
		(_name, path, value, fragment) => {
			const json = structuredClone(fullTuningJson);
			const keys = path.split(".");
			const last = keys.pop() as string;
			// biome-ignore lint/suspicious/noExplicitAny: the table walks arbitrary JSON paths
			let node: any = json;
			for (const key of keys) node = node[key];
			node[last] = value;

			expect(() => parseTuning(json)).toThrow(fragment);
		},
	);
});
