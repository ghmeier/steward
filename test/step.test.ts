import { describe, expect, test } from "bun:test";
import type { CommandLogEntry } from "../src/core/commands";
import { canonicalStringify } from "../src/core/serialize";
import { createNewGame } from "../src/core/state";
import { runSteps, step } from "../src/core/step";
import { stateHash } from "../src/save/hash";
import {
	economyTestTuning,
	quietOptions,
	sampleCommandLog,
	tuning,
} from "./helpers";

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
				{ type: "assignWorker", job: "mine", delta: -1 },
				{ type: "assignWorker", job: "mine", delta: 1 },
			],
			tuning,
			quietOptions,
		);

		expect(state.tick).toBe(1);
		expect(results.map((result) => result.ok)).toEqual([true, false, true]);
	});

	test("applies a queued assignment before the economy runs in the same tick", () => {
		const state = createNewGame(42, economyTestTuning);
		const startingGrain = economyTestTuning.economy.initialResources.grain;

		step(
			state,
			[{ type: "assignWorker", job: "farm", delta: 1 }],
			economyTestTuning,
			quietOptions,
		);

		// Tick 1 is spring: one farmer yields 0.025 before 10 people eat 0.1.
		expect(state.posting.resources.grain).toBeCloseTo(
			startingGrain + 0.025 - 0.1,
			12,
		);
	});

	test("a rejected assignment leaves labor untouched and the economy still runs", () => {
		const state = createNewGame(42, economyTestTuning);

		step(
			state,
			[{ type: "assignWorker", job: "mine", delta: -1 }],
			economyTestTuning,
			quietOptions,
		);

		expect(state.posting.economy.labor).toEqual({
			farm: 0,
			forest: 0,
			mine: 0,
		});
		expect(state.posting.resources.grain).toBeCloseTo(
			economyTestTuning.economy.initialResources.grain - 0.1,
			12,
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

describe("step decrees", () => {
	function farmingVillage(withDecree: boolean) {
		const state = createNewGame(42, economyTestTuning);
		state.posting.economy.labor.farm = 8;
		if (withDecree) {
			state.posting.decrees.granary = {
				id: "granary",
				petition: "harvest",
				rules: [],
				otherwise: "sell",
			};
		}
		return state;
	}

	test("runs the economy before decrees so a harvest decree sells that tick's surplus", () => {
		const state = farmingVillage(true);

		step(state, [], economyTestTuning, quietOptions);

		// Eight farmers make 0.2 and ten people eat 0.1; the 0.1 surplus sells at 0.5 per grain.
		expect(state.posting.resources.coin).toBeCloseTo(0.05, 12);
		expect(state.posting.resources.grain).toBeCloseTo(60, 12);
	});

	test("without a decree the same surplus stays in grain", () => {
		const state = farmingVillage(false);

		step(state, [], economyTestTuning, quietOptions);

		expect(state.posting.resources.coin).toBe(0);
		expect(state.posting.resources.grain).toBeCloseTo(60.1, 12);
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
			{ tick: 2, command: { type: "assignWorker", job: "farm", delta: 1 } },
		];
		const state = createNewGame(42, tuning);
		state.tick = 5;

		runSteps(state, 3, tuning, log, quietOptions);

		expect(state.posting.economy.labor.farm).toBe(0);
	});

	test("applies log entries for the tick being produced when resuming", () => {
		const log: CommandLogEntry[] = [
			{ tick: 6, command: { type: "assignWorker", job: "farm", delta: 1 } },
		];
		const state = createNewGame(42, tuning);
		state.tick = 5;

		runSteps(state, 3, tuning, log, quietOptions);

		expect(state.posting.economy.labor.farm).toBe(1);
	});

	test("applies same-tick entries in file order", () => {
		const log: CommandLogEntry[] = [
			{ tick: 1, command: { type: "assignWorker", job: "farm", delta: 1 } },
			{ tick: 1, command: { type: "assignWorker", job: "farm", delta: -1 } },
			{ tick: 1, command: { type: "assignWorker", job: "mine", delta: 1 } },
		];
		const state = createNewGame(42, tuning);

		runSteps(state, 1, tuning, log, quietOptions);

		expect(state.posting.economy.labor).toEqual({
			farm: 0,
			forest: 0,
			mine: 1,
		});
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
