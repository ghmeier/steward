import { describe, expect, test } from "bun:test";
import { add } from "../src/core/math";
import { createNewGame } from "../src/core/state";
import { runToySystem } from "../src/core/toy";
import type { Tuning } from "../src/core/tuning";
import { tuning } from "./helpers";

function contextFor(tick: number) {
	return { tick, maxValue: tuning.maxResourceValue, absorbed: null };
}

function withLossChance(lossChancePerMille: number): Tuning {
	return { ...tuning, toy: { ...tuning.toy, lossChancePerMille } };
}

describe("runToySystem", () => {
	test("without losses the resource equals the growth summed through add", () => {
		const noLoss = withLossChance(0);
		const state = createNewGame(42, noLoss);
		const expected: Record<string, number> = {};

		for (let tick = 1; tick <= 100; tick++) {
			runToySystem(state, noLoss, contextFor(tick));
			add(
				expected,
				noLoss.toy.resource,
				noLoss.toy.initialGrowthPerTick,
				contextFor(tick),
			);
		}

		expect(state.posting.resources[noLoss.toy.resource]).toBe(
			expected[noLoss.toy.resource] ?? Number.NaN,
		);
	});

	test("draws from the toy stream every tick even when no loss can happen", () => {
		const noLoss = withLossChance(0);
		const state = createNewGame(42, noLoss);
		const before = [...(state.posting.rng.toy ?? [])];

		runToySystem(state, noLoss, contextFor(1));

		expect(state.posting.rng.toy).not.toEqual(before);
	});

	test("with certain loss the resource never goes negative", () => {
		const alwaysLose = withLossChance(1000);
		const state = createNewGame(42, alwaysLose);
		state.posting.toy.growthPerTick = 1;
		let lowest = Number.POSITIVE_INFINITY;

		for (let tick = 1; tick <= 500; tick++) {
			runToySystem(state, alwaysLose, contextFor(tick));
			lowest = Math.min(
				lowest,
				state.posting.resources[alwaysLose.toy.resource] ?? Number.NaN,
			);
		}

		expect(lowest).toBeGreaterThanOrEqual(0);
	});

	test("with certain loss the resource ends lower than growth alone would leave it", () => {
		const alwaysLose = withLossChance(1000);
		const state = createNewGame(42, alwaysLose);
		state.posting.toy.growthPerTick = 100;

		for (let tick = 1; tick <= 10; tick++) {
			runToySystem(state, alwaysLose, contextFor(tick));
		}

		expect(state.posting.resources[alwaysLose.toy.resource]).toBeLessThan(1000);
	});

	test("throws when the toy stream is missing", () => {
		const state = createNewGame(42, tuning);
		delete state.posting.rng.toy;

		expect(() => runToySystem(state, tuning, contextFor(1))).toThrow(/toy/);
	});
});
