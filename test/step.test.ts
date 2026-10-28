import { describe, expect, test } from "bun:test";
import type { CommandLogEntry } from "../src/core/commands";
import { canonicalStringify } from "../src/core/serialize";
import { createNewGame } from "../src/core/state";
import { runSteps, step } from "../src/core/step";
import { stateHash } from "../src/save/hash";
import { quietOptions, sampleCommandLog, tuning } from "./helpers";

function runFresh(seed: number, count: number, log = sampleCommandLog) {
	const state = createNewGame(seed, tuning);
	runSteps(state, count, tuning, log, quietOptions);
	return state;
}

describe("step", () => {
	test("increments the tick by exactly one and returns one result per command", () => {
		const state = createNewGame(42, tuning);

		const results = step(
			state,
			[
				{ type: "noop" },
				{ type: "setToyRate", growthPerTick: -1 },
				{ type: "setToyRate", growthPerTick: 2 },
			],
			tuning,
			quietOptions,
		);

		expect(state.tick).toBe(1);
		expect(results.map((result) => result.ok)).toEqual([true, false, true]);
	});

	test("applies a queued setToyRate before the systems run in the same tick", () => {
		const state = createNewGame(42, tuning);
		const noLoss = { ...tuning, toy: { ...tuning.toy, lossChancePerMille: 0 } };

		step(
			state,
			[{ type: "setToyRate", growthPerTick: 10 }],
			noLoss,
			quietOptions,
		);

		expect(state.posting.resources[tuning.toy.resource]).toBe(10);
	});

	test("a rejected setToyRate leaves the toy rate untouched", () => {
		const state = createNewGame(42, tuning);
		const noLoss = { ...tuning, toy: { ...tuning.toy, lossChancePerMille: 0 } };

		step(
			state,
			[{ type: "setToyRate", growthPerTick: Number.NaN }],
			noLoss,
			quietOptions,
		);

		expect(state.posting.toy.growthPerTick).toBe(
			tuning.toy.initialGrowthPerTick,
		);
		expect(state.posting.resources[tuning.toy.resource]).toBe(
			tuning.toy.initialGrowthPerTick,
		);
	});

	test("throws naming the tick when validation finds a problem", () => {
		const state = createNewGame(42, tuning);
		state.posting.resources.bad = Number.NaN;

		expect(() =>
			step(state, [], tuning, { absorbed: null, validate: true }),
		).toThrow(/tick 1/);
	});

	test("does not validate when validate is false", () => {
		const state = createNewGame(42, tuning);
		state.posting.resources.bad = Number.NaN;

		expect(() => step(state, [], tuning, quietOptions)).not.toThrow();
	});
});

describe("runSteps", () => {
	test("keeps state valid across 10,000 validated steps", () => {
		const state = createNewGame(42, tuning);

		expect(() =>
			runSteps(state, 10_000, tuning, sampleCommandLog, {
				absorbed: null,
				validate: true,
			}),
		).not.toThrow();
		expect(state.tick).toBe(10_000);
	});

	test("does not reapply log entries for ticks already passed when resuming", () => {
		const log: CommandLogEntry[] = [
			{ tick: 2, command: { type: "setToyRate", growthPerTick: 99 } },
		];
		const state = createNewGame(42, tuning);
		state.tick = 5;

		runSteps(state, 3, tuning, log, quietOptions);

		expect(state.posting.toy.growthPerTick).toBe(
			tuning.toy.initialGrowthPerTick,
		);
	});

	test("applies log entries for the tick being produced when resuming", () => {
		const log: CommandLogEntry[] = [
			{ tick: 6, command: { type: "setToyRate", growthPerTick: 99 } },
		];
		const state = createNewGame(42, tuning);
		state.tick = 5;

		runSteps(state, 3, tuning, log, quietOptions);

		expect(state.posting.toy.growthPerTick).toBe(99);
	});

	test("applies same-tick entries in file order", () => {
		const log: CommandLogEntry[] = [
			{ tick: 1, command: { type: "setToyRate", growthPerTick: 1 } },
			{ tick: 1, command: { type: "setToyRate", growthPerTick: 2 } },
		];
		const state = createNewGame(42, tuning);

		runSteps(state, 1, tuning, log, quietOptions);

		expect(state.posting.toy.growthPerTick).toBe(2);
	});
});

describe("determinism", () => {
	test("two games with the same seed and log have identical hashes", () => {
		const first = runFresh(42, 10_000);

		const second = runFresh(42, 10_000);

		expect(stateHash(second)).toBe(stateHash(first));
	});

	test("a different seed produces a different hash", () => {
		const first = runFresh(42, 10_000);

		const other = runFresh(43, 10_000);

		expect(stateHash(other)).not.toBe(stateHash(first));
	});

	test("splitting a run at 5,000 ticks with a JSON round trip matches an uninterrupted run", () => {
		const uninterrupted = runFresh(42, 10_000);

		const resumed = createNewGame(42, tuning);
		runSteps(resumed, 5_000, tuning, sampleCommandLog, quietOptions);
		const reloaded = JSON.parse(canonicalStringify(resumed));
		runSteps(reloaded, 5_000, tuning, sampleCommandLog, quietOptions);

		expect(stateHash(reloaded)).toBe(stateHash(uninterrupted));
	});
});
