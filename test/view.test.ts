import { describe, expect, test } from "bun:test";
import { createNewGame } from "../src/core/state";
import { step } from "../src/core/step";
import { computeView } from "../src/core/view";
import { quietOptions, tuning } from "./helpers";

const oddStepTuning = { ...tuning, stepMs: 250 };

function stateWithTwoResources() {
	const state = createNewGame(1, tuning);
	state.posting.resources.zeta = 7;
	state.posting.resources.alpha = 3;
	return state;
}

describe("computeView", () => {
	test("lists every resource sorted by id with the state's amounts", () => {
		const state = stateWithTwoResources();

		const view = computeView(state, tuning);

		const ids = view.ledger.map((line) => line.resource);
		expect(ids).toEqual(Object.keys(state.posting.resources).sort());
		for (const line of view.ledger) {
			expect(line.amount).toBe(
				state.posting.resources[line.resource] as number,
			);
		}
	});

	test("gives the toy resource its steady rate per second and other resources zero", () => {
		const state = stateWithTwoResources();
		state.posting.toy.growthPerTick = 0.011;

		const view = computeView(state, oddStepTuning);

		const toy = view.ledger.find(
			(line) => line.resource === tuning.toy.resource,
		);
		const other = view.ledger.find(
			(line) => line.resource !== tuning.toy.resource,
		);
		expect(toy?.ratePerSecond).toBe(
			(state.posting.toy.growthPerTick * 1000) / oddStepTuning.stepMs,
		);
		expect(other?.ratePerSecond).toBe(0);
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
		const state = stateWithTwoResources();
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
		const view = computeView(stateWithTwoResources(), tuning);

		const roundTripped = JSON.parse(JSON.stringify(view));

		expect(roundTripped).toStrictEqual(view);
	});
});
