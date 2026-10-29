import { describe, expect, test } from "bun:test";
import { createNewGame } from "../src/core/state";
import { step } from "../src/core/step";
import { computeView } from "../src/core/view";
import {
	quietOptions,
	setRoster,
	economyTestTuning as tuning,
} from "./helpers";

const oddStepTuning = { ...tuning, stepMs: 250 };

function village() {
	const state = createNewGame(1, tuning);
	setRoster(state, { farm: 4, forest: 2, mine: 1, idle: 5 });
	return state;
}

describe("computeView", () => {
	test("lists every resource sorted by id with the state's amounts", () => {
		const state = village();
		state.posting.resources.wood = 7;

		const view = computeView(state, tuning);

		expect(view.ledger.map((line) => line.resource)).toEqual([
			"coin",
			"grain",
			"ore",
			"wood",
		]);
		for (const line of view.ledger) {
			expect(line.amount).toBe(
				state.posting.resources[line.resource] as number,
			);
		}
	});

	test("derives ledger rates from production and upkeep alone", () => {
		const state = village();
		state.tick = 1;

		const view = computeView(state, oddStepTuning);

		// Per tick in spring: grain 4 * 0.025 - 12 * 0.01, wood 2 * 0.02, ore 1 * 0.01; 4 ticks per second.
		const rates = Object.fromEntries(
			view.ledger.map((line) => [line.resource, line.ratePerSecond]),
		);
		expect(rates.grain).toBeCloseTo((0.1 - 0.12) * 4, 12);
		expect(rates.wood).toBeCloseTo(0.04 * 4, 12);
		expect(rates.ore).toBeCloseTo(0.01 * 4, 12);
		expect(rates.coin).toBe(0);
	});

	test("reports the realm's population, idle peasants, labor and season", () => {
		const state = village();
		state.tick = tuning.economy.ticksPerSeason + 1;

		const view = computeView(state, tuning);

		expect(view.realm).toEqual({
			population: 12,
			idle: 5,
			labor: { farm: 4, forest: 2, mine: 1 },
			season: "summer",
		});
	});

	test("derives elapsed seconds from the tick and the step length", () => {
		const state = createNewGame(1, tuning);
		state.tick = 50;

		const view = computeView(state, oddStepTuning);

		expect(view.tick).toBe(state.tick);
		expect(view.elapsedSeconds).toBe(
			(state.tick * oddStepTuning.stepMs) / 1000,
		);
	});

	test("leaves an earlier view unchanged when the state steps afterwards", () => {
		const state = village();
		const view = computeView(state, tuning);
		const copy = structuredClone(view);

		for (let i = 0; i < 10; i++) step(state, [], tuning, quietOptions);

		expect(view).toEqual(copy);
		expect(computeView(state, tuning)).not.toEqual(copy);
	});

	test("reports an empty desk and governors and no crown demand in phase 2", () => {
		const view = computeView(createNewGame(1, tuning), tuning);

		expect(view.desk).toEqual([]);
		expect(view.governors).toEqual([]);
		expect(view.crown).toBeNull();
	});

	test("produces plain JSON that survives a round trip unchanged", () => {
		const view = computeView(village(), tuning);

		const roundTripped = JSON.parse(JSON.stringify(view));

		expect(roundTripped).toStrictEqual(view);
	});
});

describe("computeView roster", () => {
	test("lists delegates in id order with grudge ticks left", () => {
		const state = village();
		state.tick = 10;
		const [first, second] = state.posting.delegates;
		if (first) first.grudgeUntil = 25;
		if (second) second.grudgeUntil = 10;

		const view = computeView(state, tuning);

		expect(view.delegates.map((delegate) => delegate.id)).toEqual(
			state.posting.delegates.map((delegate) => delegate.id),
		);
		expect(view.delegates[0]?.grudgeTicks).toBe(15);
		expect(view.delegates[1]?.grudgeTicks).toBe(0);
		expect(view.delegates[0]?.name).toBe(first?.name ?? "");
	});

	test("lists decrees sorted by id as copies", () => {
		const state = village();
		for (const id of ["b", "a"]) {
			state.posting.decrees[id] = {
				id,
				petition: "harvest",
				rules: [],
				otherwise: "sell",
			};
		}

		const view = computeView(state, tuning);
		view.decrees[0]?.rules.push({
			when: { kind: "season", season: "spring" },
			policy: "feed",
		});

		expect(view.decrees.map((decree) => decree.id)).toEqual(["a", "b"]);
		expect(state.posting.decrees.a?.rules).toEqual([]);
	});
});
