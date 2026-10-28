import { describe, expect, test } from "bun:test";
import type { Command } from "../src/core/commands";
import { createNewGame } from "../src/core/state";
import { runSteps } from "../src/core/step";
import { stateHash } from "../src/save/hash";
import { createSession } from "../src/tui/session";
import { quietOptions, tuning } from "./helpers";

const raiseByOne: Command = { type: "adjustToyRate", delta: 1 };

function setup(maxStepsPerFrame?: number) {
	let nowMs = 0;
	const state = createNewGame(7, tuning);
	const initial = structuredClone(state);
	const session = createSession({
		state,
		tuning,
		now: () => nowMs,
		validate: true,
		...(maxStepsPerFrame === undefined ? {} : { maxStepsPerFrame }),
	});
	session.frame();
	return {
		state,
		initial,
		session,
		advance(ms: number) {
			nowMs += ms;
			return session.frame();
		},
	};
}

describe("session frames", () => {
	test("the first frame runs no step", () => {
		const state = createNewGame(7, tuning);
		const session = createSession({ state, tuning, now: () => 0 });

		expect(session.frame().steps).toBe(0);
		expect(state.tick).toBe(0);
	});

	test("no step runs before a full stepMs has passed", () => {
		const { state, advance } = setup();

		const result = advance(tuning.stepMs - 1);

		expect(result.steps).toBe(0);
		expect(state.tick).toBe(0);
	});

	test("n stepMs of elapsed time runs exactly n steps", () => {
		const { state, advance } = setup();

		const result = advance(3 * tuning.stepMs);

		expect(result.steps).toBe(3);
		expect(state.tick).toBe(3);
	});

	test("a large time jump runs at most maxStepsPerFrame steps", () => {
		const { state, advance } = setup(5);

		const result = advance(1000 * tuning.stepMs);

		expect(result.steps).toBe(5);
		expect(state.tick).toBe(5);
	});
});

describe("session commands", () => {
	test("a command applies in the next step and is logged with that step's tick", () => {
		const { state, session, advance } = setup();
		const before = state.posting.toy.growthPerTick;

		session.enqueue(raiseByOne);
		expect(state.posting.toy.growthPerTick).toBe(before);
		advance(tuning.stepMs);

		expect(state.posting.toy.growthPerTick).toBe(before + 1);
		expect(session.commandLog).toEqual([{ tick: 1, command: raiseByOne }]);
	});

	test("a command enqueued before a zero-step frame stays queued for the next stepping frame", () => {
		const { session, advance } = setup();

		session.enqueue(raiseByOne);
		advance(1);
		expect(session.commandLog).toEqual([]);
		advance(tuning.stepMs);

		expect(session.commandLog).toEqual([{ tick: 1, command: raiseByOne }]);
	});

	test("in a multi-step frame only the first step receives queued commands", () => {
		const { session, advance } = setup();

		session.enqueue(raiseByOne);
		advance(3 * tuning.stepMs);

		expect(session.commandLog.map((entry) => entry.tick)).toEqual([1]);
	});

	test("a rejected command is reported with its tick and reason and still logged", () => {
		const { session, advance } = setup();
		const tooLow: Command = { type: "adjustToyRate", delta: -1e9 };

		session.enqueue(tooLow);
		const result = advance(tuning.stepMs);

		expect(result.rejections).toHaveLength(1);
		expect(result.rejections[0]).toMatchObject({ tick: 1, command: tooLow });
		expect(result.rejections[0]?.reason).toContain("below 0");
		expect(session.commandLog).toEqual([{ tick: 1, command: tooLow }]);
	});

	test("an accepted command produces no rejection", () => {
		const { session, advance } = setup();

		session.enqueue(raiseByOne);

		expect(advance(tuning.stepMs).rejections).toEqual([]);
	});
});

describe("session view", () => {
	test("viewChanged is true after a stepping frame and view reflects the new tick", () => {
		const { state, session, advance } = setup();

		const result = advance(tuning.stepMs);

		expect(result.viewChanged).toBe(true);
		expect(session.view().tick).toBe(state.tick);
	});

	test("viewChanged is false after a frame that ran no step", () => {
		const { session, advance } = setup();
		const before = session.view();

		const result = advance(1);

		expect(result.viewChanged).toBe(false);
		expect(session.view()).toBe(before);
	});
});

describe("session replay", () => {
	test("replaying the command log on a fresh clone reproduces the live state hash", () => {
		const { state, initial, session, advance } = setup();
		const script: [number, Command | null][] = [
			[tuning.stepMs, { type: "adjustToyRate", delta: 2 }],
			[7 * tuning.stepMs, null],
			[tuning.stepMs / 2, { type: "adjustToyRate", delta: -1e9 }],
			[tuning.stepMs, { type: "setToyRate", growthPerTick: 0.75 }],
			[40 * tuning.stepMs, { type: "adjustToyRate", delta: -0.25 }],
			[3 * tuning.stepMs, null],
		];

		for (const [ms, command] of script) {
			if (command) session.enqueue(command);
			advance(ms);
		}
		runSteps(initial, state.tick, tuning, session.commandLog, quietOptions);

		expect(state.tick).toBeGreaterThan(40);
		expect(session.commandLog.length).toBe(4);
		expect(stateHash(initial)).toBe(stateHash(state));
	});
});
