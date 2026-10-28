import { describe, expect, test } from "bun:test";
import {
	apply,
	type CommandLogEntry,
	parseCommand,
	parseCommandLog,
} from "../src/core/commands";
import { idlePeasants } from "../src/core/economy";
import { canonicalStringify } from "../src/core/serialize";
import { createNewGame } from "../src/core/state";
import { tuning } from "./helpers";

describe("apply", () => {
	test("assignWorker +1 moves one idle peasant into the job", () => {
		const state = createNewGame(1, tuning);

		const result = apply(
			state,
			{ type: "assignWorker", job: "forest", delta: 1 },
			tuning,
		);

		expect(result).toEqual({ ok: true });
		expect(state.posting.economy.labor).toEqual({
			farm: 0,
			forest: 1,
			mine: 0,
		});
		expect(idlePeasants(state.posting.economy)).toBe(
			tuning.economy.initialPopulation - 1,
		);
	});

	test("assignWorker +1 is rejected when no peasant is idle", () => {
		const state = createNewGame(1, tuning);
		state.posting.economy.labor.farm = state.posting.economy.population;
		const before = canonicalStringify(state);

		const result = apply(
			state,
			{ type: "assignWorker", job: "mine", delta: 1 },
			tuning,
		);

		expect(result).toEqual({ ok: false, reason: "no idle peasants" });
		expect(canonicalStringify(state)).toBe(before);
	});

	test("assignWorker -1 returns one worker of that job to idle", () => {
		const state = createNewGame(1, tuning);
		state.posting.economy.labor.mine = 2;

		const result = apply(
			state,
			{ type: "assignWorker", job: "mine", delta: -1 },
			tuning,
		);

		expect(result).toEqual({ ok: true });
		expect(state.posting.economy.labor.mine).toBe(1);
	});

	test("assignWorker -1 is rejected when nobody works that job", () => {
		const state = createNewGame(1, tuning);
		state.posting.economy.labor.farm = 3;
		const before = canonicalStringify(state);

		const result = apply(
			state,
			{ type: "assignWorker", job: "mine", delta: -1 },
			tuning,
		);

		expect(result).toEqual({ ok: false, reason: "no peasants work the mine" });
		expect(canonicalStringify(state)).toBe(before);
	});

	test.each([0, 2, -2, 0.5, Number.NaN])(
		"assignWorker rejects a delta of %p and changes nothing",
		(delta) => {
			const state = createNewGame(1, tuning);
			state.posting.economy.labor.farm = 3;
			const before = canonicalStringify(state);

			const result = apply(
				state,
				{ type: "assignWorker", job: "farm", delta },
				tuning,
			);

			expect(result.ok).toBe(false);
			expect(canonicalStringify(state)).toBe(before);
		},
	);

	test("noop changes nothing", () => {
		const state = createNewGame(1, tuning);
		const before = canonicalStringify(state);

		const result = apply(state, { type: "noop" }, tuning);

		expect(result).toEqual({ ok: true });
		expect(canonicalStringify(state)).toBe(before);
	});
});

describe("parseCommand", () => {
	test("accepts noop and assignWorker", () => {
		expect(parseCommand({ type: "noop" })).toEqual({ type: "noop" });
		expect(
			parseCommand({ type: "assignWorker", job: "farm", delta: -1 }),
		).toEqual({ type: "assignWorker", job: "farm", delta: -1 });
	});

	test("accepts enactDecree and repealDecree without judging the decree", () => {
		expect(parseCommand({ type: "enactDecree", decree: { id: 1 } })).toEqual({
			type: "enactDecree",
			decree: { id: 1 },
		});
		expect(parseCommand({ type: "repealDecree", id: "granary" })).toEqual({
			type: "repealDecree",
			id: "granary",
		});
	});

	test.each([
		["a non-object", 5],
		["a non-object decree", { type: "enactDecree", decree: "granary" }],
		["a missing decree", { type: "enactDecree" }],
		["a non-string repeal id", { type: "repealDecree", id: 3 }],
		["an array", []],
		["an unknown type", { type: "explode" }],
		["a missing type", {}],
		["a missing job", { type: "assignWorker", delta: 1 }],
		["an unknown job", { type: "assignWorker", job: "bank", delta: 1 }],
		["a missing delta", { type: "assignWorker", job: "farm" }],
		["a string delta", { type: "assignWorker", job: "farm", delta: "1" }],
		["a null delta", { type: "assignWorker", job: "farm", delta: null }],
		[
			"an infinite delta",
			{ type: "assignWorker", job: "farm", delta: Number.POSITIVE_INFINITY },
		],
	])("rejects %s", (_name, input) => {
		expect(() => parseCommand(input)).toThrow();
	});
});

describe("parseCommandLog", () => {
	test("accepts a sorted log and keeps same-tick entries in file order", () => {
		const input: CommandLogEntry[] = [
			{ tick: 1, command: { type: "noop" } },
			{ tick: 3, command: { type: "assignWorker", job: "farm", delta: 1 } },
			{ tick: 3, command: { type: "assignWorker", job: "mine", delta: -1 } },
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
