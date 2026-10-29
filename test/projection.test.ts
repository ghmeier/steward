import { describe, expect, test } from "bun:test";
import { enactDecree } from "../src/core/decree-engine";
import { projectedRates, projectFlows } from "../src/core/projection";
import { RESOURCES } from "../src/core/realm";
import { createNewGame } from "../src/core/state";
import { step } from "../src/core/step";
import {
	quietOptions,
	setRoster,
	economyTestTuning as tuning,
} from "./helpers";

const economy = tuning.economy;
const midSpring = 100;

function villageAt(tick: number, farmers: number, idlers: number, grain = 60) {
	const state = createNewGame(1, tuning);
	state.tick = tick;
	state.posting.desk.nextArrivalTick = 1e9;
	setRoster(state, { farm: farmers, idle: idlers });
	state.posting.resources.grain = grain;
	return state;
}

function enactHarvest(
	state: ReturnType<typeof villageAt>,
	policy: "sell" | "feed",
) {
	const result = enactDecree(
		state,
		{ id: "harvest", petition: "harvest", rules: [], otherwise: policy },
		tuning,
	);
	expect(result).toEqual({ ok: true });
}

describe("projectedRates", () => {
	test("with no decrees grain is hand-computed production minus upkeep", () => {
		const state = villageAt(midSpring, 8, 2);

		const rates = projectedRates(state, tuning);

		const production = 8 * economy.grainPerFarmer * economy.seasonYield.spring;
		const upkeep = 10 * economy.grainPerPerson;
		expect(rates.grain).toBeCloseTo(production - upkeep, 12);
		expect(rates.coin).toBe(0);
	});

	test("a sell decree turns the surplus into coin and leaves grain flat", () => {
		const state = villageAt(midSpring, 8, 2);
		enactHarvest(state, "sell");

		const rates = projectedRates(state, tuning);

		const surplus =
			8 * economy.grainPerFarmer * economy.seasonYield.spring -
			10 * economy.grainPerPerson;
		expect(surplus).toBeGreaterThan(0);
		expect(rates.grain).toBeCloseTo(0, 12);
		expect(rates.coin).toBeCloseTo(surplus * economy.grainPrice, 12);
	});

	test("a feed decree consumes the surplus so grain is flat", () => {
		const state = villageAt(midSpring, 8, 2);
		enactHarvest(state, "feed");

		const rates = projectedRates(state, tuning);

		expect(rates.grain).toBeCloseTo(0, 12);
	});

	test("on the last tick of a season the rate uses the next season's yield", () => {
		const state = villageAt(economy.ticksPerSeason, 8, 2);

		const rates = projectedRates(state, tuning);

		const summer = 8 * economy.grainPerFarmer * economy.seasonYield.summer;
		expect(rates.grain).toBeCloseTo(summer - 10 * economy.grainPerPerson, 12);
	});

	test("a farmer whose grudge ends next tick counts toward production", () => {
		const state = villageAt(midSpring, 2, 0);
		const farmer = state.posting.delegates[0];
		if (!farmer) throw new Error("no farmer");
		farmer.grudgeUntil = state.tick + 1;

		const rates = projectedRates(state, tuning);

		expect(rates.grain).toBeCloseTo(
			2 * economy.grainPerFarmer - 2 * economy.grainPerPerson,
			12,
		);
	});

	test("a farmer whose grudge ends a tick later does not count", () => {
		const state = villageAt(midSpring, 2, 0);
		const farmer = state.posting.delegates[0];
		if (!farmer) throw new Error("no farmer");
		farmer.grudgeUntil = state.tick + 2;

		const rates = projectedRates(state, tuning);

		expect(rates.grain).toBeCloseTo(
			1 * economy.grainPerFarmer - 2 * economy.grainPerPerson,
			12,
		);
	});

	test("empty stores with production below upkeep project zero, not a negative rate", () => {
		const state = villageAt(midSpring, 1, 9, 0);

		const rates = projectedRates(state, tuning);

		expect(rates.grain).toBe(0);
	});

	test("non-empty stores with production below upkeep project the negative rate", () => {
		const state = villageAt(midSpring, 1, 9, 60);

		const rates = projectedRates(state, tuning);

		const production = economy.grainPerFarmer * economy.seasonYield.spring;
		expect(rates.grain).toBeCloseTo(
			production - 10 * economy.grainPerPerson,
			12,
		);
		expect(rates.grain).toBeLessThan(0);
	});

	test("does not change the state it projects from, RNG streams included", () => {
		const state = villageAt(midSpring, 8, 2);
		enactHarvest(state, "feed");
		state.posting.economy.growth = economy.grainPerPeasant - 0.001;
		const before = structuredClone(state);

		projectedRates(state, tuning);

		expect(state).toEqual(before);
	});

	test("equals the real per-resource change of a step on every tick the desk is unchanged", () => {
		const state = createNewGame(7, tuning);
		enactDecree(
			state,
			{
				id: "harvest",
				petition: "harvest",
				rules: [
					{
						when: {
							kind: "compare",
							quantity: "grain",
							comparison: "above",
							value: 80,
						},
						policy: "sell",
					},
					{ when: { kind: "season", season: "winter" }, policy: "feed" },
				],
				otherwise: "stockpile",
			},
			tuning,
		);
		enactDecree(
			state,
			{ id: "work", petition: "labor", rules: [], otherwise: "farming" },
			tuning,
		);

		let compared = 0;
		for (let i = 0; i < 1500; i++) {
			const { desk } = state.posting;
			const deskBefore = [desk.disputes.length, desk.nextDisputeId];
			const before = { ...state.posting.resources };
			const projected = projectedRates(state, tuning);

			step(state, [], tuning, quietOptions);

			const after = state.posting.desk;
			if (
				after.disputes.length !== deskBefore[0] ||
				after.nextDisputeId !== deskBefore[1]
			) {
				continue;
			}
			compared += 1;
			for (const resource of RESOURCES) {
				expect(projected[resource]).toBe(
					(state.posting.resources[resource] ?? 0) - (before[resource] ?? 0),
				);
			}
		}
		expect(compared).toBeGreaterThan(1000);
	});
});

describe("projectFlows growthPerTick", () => {
	function realGrowthChange(state: ReturnType<typeof villageAt>) {
		const before = state.posting.economy.growth;
		const after = structuredClone(state);
		step(after, [], tuning, quietOptions);
		return after.posting.economy.growth - before;
	}

	test("equals the grain fed on the next tick when no birth happens", () => {
		const state = villageAt(midSpring, 8, 2);
		enactHarvest(state, "feed");

		const { growthPerTick } = projectFlows(state, tuning);

		expect(growthPerTick).toBeGreaterThan(0);
		expect(growthPerTick).toBeCloseTo(realGrowthChange(state), 12);
	});

	test("stays the grain fed on a tick that completes a birth", () => {
		const state = villageAt(midSpring, 8, 2);
		enactHarvest(state, "feed");
		const fed = projectFlows(state, tuning).growthPerTick;
		state.posting.economy.growth = economy.grainPerPeasant - fed / 2;
		const after = structuredClone(state);
		step(after, [], tuning, quietOptions);

		const { growthPerTick } = projectFlows(state, tuning);

		expect(after.posting.delegates.length).toBe(
			state.posting.delegates.length + 1,
		);
		expect(growthPerTick).toBeCloseTo(
			after.posting.economy.growth -
				state.posting.economy.growth +
				economy.grainPerPeasant,
			12,
		);
	});

	test("is zero with no feed decree", () => {
		const state = villageAt(midSpring, 8, 2);

		expect(projectFlows(state, tuning).growthPerTick).toBe(0);
	});
});
