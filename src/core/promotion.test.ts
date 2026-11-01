import { describe, expect, test } from "bun:test";
import {
  quietOptions,
  setRoster,
  economyTestTuning as tuning,
} from "../../test/helpers";
import { bearPeasant } from "./delegates";
import { createNewGame, type GameState } from "./state";
import { step } from "./step";

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
