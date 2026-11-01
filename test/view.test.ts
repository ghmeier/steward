import { describe, expect, test } from "bun:test";
import type { Decree } from "../src/core/decree";
import { projectFlows } from "../src/core/projection";
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

function feedDecree(): Decree {
	return { id: "harvest", petition: "harvest", rules: [], otherwise: "feed" };
}

describe("computeView", () => {
	test("lists every resource sorted by id with the state's amounts and per-second rates", () => {
		const state = village();
		state.tick = 1;
		state.posting.resources.wood = 7;

		const view = computeView(state, oddStepTuning);

		// Per tick in spring: grain 4 * 0.025 - 12 * 0.01, wood 2 * 0.02, ore 1 * 0.01; 4 ticks per second.
		const byResource = Object.fromEntries(
			view.ledger.map((line) => [line.resource, line]),
		);
		expect(view.ledger.map((line) => line.resource)).toEqual([
			"coin",
			"grain",
			"ore",
			"wood",
		]);
		expect(byResource.wood?.amount).toBe(7);
		expect(byResource.grain?.ratePerSecond).toBeCloseTo((0.1 - 0.12) * 4, 12);
		expect(byResource.wood?.ratePerSecond).toBeCloseTo(0.04 * 4, 12);
		expect(byResource.ore?.ratePerSecond).toBeCloseTo(0.01 * 4, 12);
		expect(byResource.coin?.ratePerSecond).toBe(0);
	});

	test("reports the realm's counts, season, elapsed time, locked panels and promotion", () => {
		const state = village();
		state.tick = tuning.economy.ticksPerSeason + 1;
		state.posting.economy.starved = 7;
		state.career.promotedAt = 7;
		const grudged = state.posting.delegates[0];
		if (grudged) grudged.grudgeUntil = state.tick + 50;

		const view = computeView(state, oddStepTuning);

		expect(view.realm).toEqual({
			population: 12,
			idle: 5,
			labor: { farm: 4, forest: 2, mine: 1 },
			season: "summer",
			starved: 7,
		});
		expect(view.elapsedSeconds).toBe((state.tick * 250) / 1000);
		expect(view.lockedPanels).toEqual(["crown"]);
		expect(view.promotion).toEqual({
			target: tuning.village.promotionPopulation,
			promotedAt: 7,
			promotedAtSeconds: (7 * oddStepTuning.stepMs) / 1000,
		});
	});

	test("lists delegates in id order with grudge ticks left, and decrees sorted by id as copies", () => {
		const state = village();
		state.tick = 10;
		const [first, second] = state.posting.delegates;
		if (first) first.grudgeUntil = 25;
		if (second) second.grudgeUntil = 4;
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

		expect(view.delegates.map((delegate) => delegate.id)).toEqual(
			state.posting.delegates.map((delegate) => delegate.id),
		);
		expect(view.delegates.slice(0, 2).map((d) => d.grudgeTicks)).toEqual([
			15, 0,
		]);
		expect(view.decrees.map((decree) => decree.id)).toEqual(["a", "b"]);
		expect(state.posting.decrees.a?.rules).toEqual([]);
	});

	test("an earlier view stays unchanged when the state steps afterwards, and survives a JSON round trip", () => {
		const state = village();
		state.posting.decrees.harvest = feedDecree();
		const view = computeView(state, tuning);
		const copy = structuredClone(view);

		for (let i = 0; i < 10; i++) step(state, [], tuning, quietOptions);

		expect(view).toEqual(copy);
		expect(computeView(state, tuning)).not.toEqual(copy);
		expect(JSON.parse(JSON.stringify(view))).toStrictEqual(view);
	});
});

describe("computeView growth", () => {
	test("reports stored growth, the needed grain and a per-second feed rate", () => {
		const state = village();
		state.posting.decrees.harvest = feedDecree();
		state.tick = 100;
		setRoster(state, { farm: 8, idle: 2 });
		state.posting.economy.growth = 7;

		const { growth } = computeView(state, oddStepTuning);

		expect(growth.stored).toBe(7);
		expect(growth.needed).toBe(tuning.economy.grainPerPeasant);
		expect(growth.perSecond).toBeGreaterThan(0);
		expect(growth.perSecond).toBeCloseTo(
			(projectFlows(state, oddStepTuning).growthPerTick * 1000) / 250,
			12,
		);
	});

	test.each([
		["below", 39, false],
		["at", 40, true],
	])(
		"growth is full only when the population is %s maxPopulation",
		(_n, idle, full) => {
			const state = createNewGame(1, tuning);
			setRoster(state, { idle });

			expect(computeView(state, tuning).growth.full).toBe(full);
		},
	);
});
