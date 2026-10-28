import { describe, expect, test } from "bun:test";
import {
	apply,
	type CommandLogEntry,
	parseCommand,
	parseCommandLog,
} from "../src/core/commands";
import { canonicalStringify } from "../src/core/serialize";
import { createNewGame } from "../src/core/state";
import { tuning } from "./helpers";

describe("apply", () => {
	test("setToyRate stores a valid rate", () => {
		const state = createNewGame(1, tuning);

		const result = apply(
			state,
			{ type: "setToyRate", growthPerTick: 4 },
			tuning,
		);

		expect(result).toEqual({ ok: true });
		expect(state.posting.toy.growthPerTick).toBe(4);
	});

	test("setToyRate accepts zero and the maximum resource value", () => {
		const state = createNewGame(1, tuning);

		const zero = apply(state, { type: "setToyRate", growthPerTick: 0 }, tuning);
		const max = apply(
			state,
			{ type: "setToyRate", growthPerTick: tuning.maxResourceValue },
			tuning,
		);

		expect(zero.ok).toBe(true);
		expect(max.ok).toBe(true);
	});

	test.each([
		["negative", -1],
		["NaN", Number.NaN],
		["infinite", Number.POSITIVE_INFINITY],
		["above the maximum", tuning.maxResourceValue * 2],
	])("setToyRate rejects a %s rate and changes nothing", (_name, rate) => {
		const state = createNewGame(1, tuning);
		const before = canonicalStringify(state);

		const result = apply(
			state,
			{ type: "setToyRate", growthPerTick: rate },
			tuning,
		);

		expect(result.ok).toBe(false);
		expect(canonicalStringify(state)).toBe(before);
	});

	test("noop changes nothing", () => {
		const state = createNewGame(1, tuning);
		const before = canonicalStringify(state);

		const result = apply(state, { type: "noop" }, tuning);

		expect(result).toEqual({ ok: true });
		expect(canonicalStringify(state)).toBe(before);
	});
});

describe("parseCommand", () => {
	test("accepts noop and setToyRate", () => {
		expect(parseCommand({ type: "noop" })).toEqual({ type: "noop" });
		expect(parseCommand({ type: "setToyRate", growthPerTick: 2 })).toEqual({
			type: "setToyRate",
			growthPerTick: 2,
		});
	});

	test.each([
		["a non-object", 5],
		["an array", []],
		["an unknown type", { type: "explode" }],
		["a missing type", {}],
		["a missing growthPerTick", { type: "setToyRate" }],
		["a string growthPerTick", { type: "setToyRate", growthPerTick: "1" }],
		["a null growthPerTick", { type: "setToyRate", growthPerTick: null }],
	])("rejects %s", (_name, input) => {
		expect(() => parseCommand(input)).toThrow();
	});
});

describe("parseCommandLog", () => {
	test("accepts a sorted log and keeps same-tick entries in file order", () => {
		const input: CommandLogEntry[] = [
			{ tick: 1, command: { type: "noop" } },
			{ tick: 3, command: { type: "setToyRate", growthPerTick: 1 } },
			{ tick: 3, command: { type: "setToyRate", growthPerTick: 2 } },
		];

		const log = parseCommandLog(input);

		expect(log).toEqual(input);
	});

	test("accepts an empty log", () => {
		expect(parseCommandLog([])).toEqual([]);
	});

	test.each([
		["a non-array", {}],
		[
			"decreasing ticks",
			[
				{ tick: 5, command: { type: "noop" } },
				{ tick: 4, command: { type: "noop" } },
			],
		],
		["a fractional tick", [{ tick: 1.5, command: { type: "noop" } }]],
		["a zero tick", [{ tick: 0, command: { type: "noop" } }]],
		["a missing tick", [{ command: { type: "noop" } }]],
		["an unknown command", [{ tick: 1, command: { type: "nope" } }]],
		["a missing command", [{ tick: 1 }]],
	])("rejects %s", (_name, input) => {
		expect(() => parseCommandLog(input)).toThrow();
	});
});
