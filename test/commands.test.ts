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

	test("adjustToyRate raises and lowers the rate by delta", () => {
		const state = createNewGame(1, tuning);
		const start = state.posting.toy.growthPerTick;

		apply(state, { type: "adjustToyRate", delta: 2 }, tuning);
		const raised = state.posting.toy.growthPerTick;
		apply(state, { type: "adjustToyRate", delta: -1 }, tuning);

		expect(raised).toBe(start + 2);
		expect(state.posting.toy.growthPerTick).toBe(start + 1);
	});

	test("adjustToyRate accepts a delta that lands exactly on zero", () => {
		const state = createNewGame(1, tuning);
		const delta = -state.posting.toy.growthPerTick;

		const result = apply(state, { type: "adjustToyRate", delta }, tuning);

		expect(result).toEqual({ ok: true });
		expect(Object.is(state.posting.toy.growthPerTick, 0)).toBe(true);
	});

	test("adjustToyRate rejects a delta below zero with a reason and changes nothing", () => {
		const state = createNewGame(1, tuning);
		const before = canonicalStringify(state);
		const delta = -state.posting.toy.growthPerTick - 1;

		const result = apply(state, { type: "adjustToyRate", delta }, tuning);

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).not.toBe("");
		expect(canonicalStringify(state)).toBe(before);
	});

	test.each([
		["above the maximum", tuning.maxResourceValue * 2],
		["NaN", Number.NaN],
		["infinite", Number.POSITIVE_INFINITY],
	])("adjustToyRate rejects a delta %s and changes nothing", (_name, delta) => {
		const state = createNewGame(1, tuning);
		state.posting.toy.growthPerTick = 1;
		const before = canonicalStringify(state);

		const result = apply(state, { type: "adjustToyRate", delta }, tuning);

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

	test("accepts adjustToyRate with a finite delta", () => {
		expect(parseCommand({ type: "adjustToyRate", delta: -0.5 })).toEqual({
			type: "adjustToyRate",
			delta: -0.5,
		});
	});

	test.each([
		["a missing delta", { type: "adjustToyRate" }],
		["a string delta", { type: "adjustToyRate", delta: "1" }],
		["a null delta", { type: "adjustToyRate", delta: null }],
		["a NaN delta", { type: "adjustToyRate", delta: Number.NaN }],
		[
			"an infinite delta",
			{ type: "adjustToyRate", delta: Number.POSITIVE_INFINITY },
		],
	])("rejects adjustToyRate with %s", (_name, input) => {
		expect(() => parseCommand(input)).toThrow();
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
