import { describe, expect, test } from "bun:test";
import {
	apply,
	type CommandLogEntry,
	parseCommand,
	parseCommandLog,
} from "../src/core/commands";
import { idleCount, laborCounts } from "../src/core/delegates";
import { canonicalStringify } from "../src/core/serialize";
import { createNewGame } from "../src/core/state";
import { contextFor, setRoster, tuning } from "./helpers";

describe("apply", () => {
	test("assignPeasant moves exactly the named peasant", () => {
		const state = createNewGame(1, tuning);
		setRoster(state, { idle: 3 });
		const [first, second] = state.posting.delegates;

		const result = apply(
			state,
			{ type: "assignPeasant", peasant: second?.id ?? 0, job: "forest" },
			tuning,
			contextFor(state),
		);

		expect(result).toEqual({ ok: true });
		expect(second?.job).toBe("forest");
		expect(first?.job).toBe("idle");
		expect(laborCounts(state.posting.delegates)).toEqual({
			farm: 0,
			forest: 1,
			mine: 0,
		});
		expect(idleCount(state.posting.delegates)).toBe(2);
	});

	test("assignPeasant can send a worker back to idle", () => {
		const state = createNewGame(1, tuning);
		const peasant = state.posting.delegates[0];
		if (peasant) peasant.job = "mine";

		const result = apply(
			state,
			{ type: "assignPeasant", peasant: peasant?.id ?? 0, job: "idle" },
			tuning,
			contextFor(state),
		);

		expect(result).toEqual({ ok: true });
		expect(peasant?.job).toBe("idle");
	});

	test("assignPeasant is rejected for a peasant who does not exist", () => {
		const state = createNewGame(1, tuning);
		const before = canonicalStringify(state);

		const result = apply(
			state,
			{ type: "assignPeasant", peasant: 7777, job: "mine" },
			tuning,
			contextFor(state),
		);

		expect(result).toEqual({ ok: false, reason: "no peasant 7777" });
		expect(canonicalStringify(state)).toBe(before);
	});

	test("assignPeasant is rejected when the peasant already has that job", () => {
		const state = createNewGame(1, tuning);
		setRoster(state, { idle: 2 });
		const peasant = state.posting.delegates[0];
		if (peasant) peasant.job = "farm";
		const before = canonicalStringify(state);

		const working = apply(
			state,
			{ type: "assignPeasant", peasant: peasant?.id ?? 0, job: "farm" },
			tuning,
			contextFor(state),
		);
		const idle = apply(
			state,
			{
				type: "assignPeasant",
				peasant: state.posting.delegates[1]?.id ?? 0,
				job: "idle",
			},
			tuning,
			contextFor(state),
		);

		expect(working).toEqual({
			ok: false,
			reason: `${peasant?.name} already works the farm`,
		});
		expect(idle).toEqual({
			ok: false,
			reason: `${state.posting.delegates[1]?.name} is already idle`,
		});
		expect(canonicalStringify(state)).toBe(before);
	});

	test("assignPeasant refuses a grudged peasant a job but allows idle", () => {
		const state = createNewGame(1, tuning);
		state.tick = 10;
		const peasant = state.posting.delegates[0];
		if (peasant === undefined) throw new Error("no peasant");
		peasant.grudgeUntil = 20;
		peasant.job = "farm";
		const send = (job: "mine" | "idle") =>
			apply(
				state,
				{ type: "assignPeasant", peasant: peasant.id, job },
				tuning,
				contextFor(state),
			);

		expect(send("mine")).toEqual({
			ok: false,
			reason: `${peasant.name} refuses to work (grudge)`,
		});
		expect(peasant.job).toBe("farm");
		expect(send("idle")).toEqual({ ok: true });
		expect<string>(peasant.job).toBe("idle");
	});

	test("assignPeasant accepts a job once the grudge has ended", () => {
		const state = createNewGame(1, tuning);
		const peasant = state.posting.delegates[0];
		if (peasant === undefined) throw new Error("no peasant");
		peasant.grudgeUntil = 20;
		const send = () =>
			apply(
				state,
				{ type: "assignPeasant", peasant: peasant.id, job: "mine" },
				tuning,
				contextFor(state),
			);

		state.tick = 19;
		expect(send().ok).toBe(false);
		state.tick = 20;
		expect(send()).toEqual({ ok: true });
	});

	test("noop changes nothing", () => {
		const state = createNewGame(1, tuning);
		const before = canonicalStringify(state);

		const result = apply(state, { type: "noop" }, tuning, contextFor(state));

		expect(result).toEqual({ ok: true });
		expect(canonicalStringify(state)).toBe(before);
	});
});

describe("parseCommand", () => {
	test("accepts noop and assignPeasant", () => {
		expect(parseCommand({ type: "noop" })).toEqual({ type: "noop" });
		expect(
			parseCommand({ type: "assignPeasant", peasant: 3, job: "idle" }),
		).toEqual({ type: "assignPeasant", peasant: 3, job: "idle" });
		expect(
			parseCommand({ type: "assignPeasant", peasant: 4, job: "farm" }),
		).toEqual({ type: "assignPeasant", peasant: 4, job: "farm" });
	});

	test("accepts enactDecree and repealDecree without judging the decree", () => {
		const decree = { id: 1 };

		const parsed = parseCommand({ type: "enactDecree", decree });

		expect(parsed).toEqual({ type: "enactDecree", decree: { id: 1 } });
		expect(parsed.type === "enactDecree" && parsed.decree).not.toBe(decree);
		expect(parseCommand({ type: "repealDecree", id: "granary" })).toEqual({
			type: "repealDecree",
			id: "granary",
		});
	});

	test("rejects a command with an unknown type or without a type", () => {
		expect(() => parseCommand({ type: "explode" })).toThrow("command.type");
		expect(() => parseCommand({})).toThrow("command.type");
	});
});

describe("parseCommandLog", () => {
	test("accepts a sorted log and keeps same-tick entries in file order", () => {
		const input: CommandLogEntry[] = [
			{ tick: 1, command: { type: "noop" } },
			{
				tick: 3,
				command: { type: "assignPeasant", peasant: 1, job: "farm" },
			},
			{
				tick: 3,
				command: { type: "assignPeasant", peasant: 2, job: "idle" },
			},
		];

		const log = parseCommandLog(input);

		expect(log).toEqual(input);
	});

	test("accepts an empty log", () => {
		expect(parseCommandLog([])).toEqual([]);
	});

	test("rejects decreasing ticks, naming the entry", () => {
		const log = [
			{ tick: 5, command: { type: "noop" } },
			{ tick: 4, command: { type: "noop" } },
		];

		expect(() => parseCommandLog(log)).toThrow("command log[1].tick");
	});

	test("rejects a bad command inside an entry, naming the entry and field", () => {
		const log = [{ tick: 1, command: { type: "buyUnlock", id: 3 } }];

		expect(() => parseCommandLog(log)).toThrow("command log[0].command.id");
	});
});
