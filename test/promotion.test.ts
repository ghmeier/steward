import { describe, expect, test } from "bun:test";
import { bearPeasant } from "../src/core/delegates";
import { createNewGame, type GameState } from "../src/core/state";
import { step } from "../src/core/step";
import {
	quietOptions,
	setRoster,
	economyTestTuning as tuning,
} from "./helpers";

const target = tuning.village.promotionPopulation;

function villageOf(population: number): GameState {
	const state = createNewGame(1, tuning);
	setRoster(state, { idle: population });
	return state;
}

describe("promotion", () => {
	test("fires at the first step where the population reaches the target, and not before", () => {
		const state = villageOf(target - 1);
		for (let i = 0; i < 5; i++) step(state, [], tuning, quietOptions);
		expect(state.career.promotedAt).toBe(0);

		bearPeasant(state.posting, tuning.village.names);
		step(state, [], tuning, quietOptions);

		expect(state.career.promotedAt).toBe(state.tick);
		expect(state.tick).toBe(6);
	});

	test("stays set after the population falls below the target", () => {
		const state = villageOf(target);
		step(state, [], tuning, quietOptions);

		setRoster(state, { idle: 2 });
		for (let i = 0; i < 3; i++) step(state, [], tuning, quietOptions);

		expect(state.career.promotedAt).toBe(1);
	});
});
