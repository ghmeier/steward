import { describe, expect, test } from "bun:test";
import type { CommandLogEntry } from "../src/core/commands";
import { laborCounts } from "../src/core/delegates";
import { createNewGame } from "../src/core/state";
import { runSteps, step } from "../src/core/step";
import {
	economyTestTuning,
	quietOptions,
	sampleVillage,
	tuning,
} from "./helpers";

const assign = (
	tick: number,
	peasant: number,
	job: "farm" | "forest" | "mine" | "idle",
): CommandLogEntry => ({
	tick,
	command: { type: "assignPeasant", peasant, job },
});

describe("step", () => {
	test("returns one result per command and applies assignments before the economy runs", () => {
		const state = createNewGame(42, economyTestTuning);
		const startingGrain = economyTestTuning.economy.initialResources.grain;

		const results = step(
			state,
			[
				{ type: "noop" },
				{ type: "assignPeasant", peasant: 999, job: "mine" },
				{ type: "assignPeasant", peasant: 1, job: "farm" },
			],
			economyTestTuning,
			quietOptions,
		);

		expect(state.tick).toBe(1);
		expect(results.map((result) => result.ok)).toEqual([true, false, true]);
		expect(laborCounts(state.posting.delegates).farm).toBe(1);
		// Tick 1 is spring: one farmer yields 0.025 before 10 people eat 0.1.
		expect(state.posting.resources.grain).toBeCloseTo(
			startingGrain + 0.025 - 0.1,
			12,
		);
	});

	test.each([
		["throws naming the tick when validation finds a problem", true],
		["does not validate when validate is false", false],
	])("%s", (_name, validate) => {
		const state = createNewGame(42, tuning);
		state.posting.resources.bad = Number.NaN;
		const run = () => step(state, [], tuning, { absorbed: null, validate });

		if (validate) expect(run).toThrow(/tick 1/);
		else expect(run).not.toThrow();
	});
});

describe("runSteps", () => {
	test("keeps state valid across 10,000 validated steps of a ten-peasant village", () => {
		const state = sampleVillage(42);
		const jobs = ["farm", "forest", "mine"] as const;
		const log = [
			...Array.from({ length: 10 }, (_, i) =>
				assign(i + 1, i + 1, jobs[i % 3] ?? "farm"),
			),
			assign(3000, 1, "idle"),
			assign(3001, 1, "forest"),
		];

		expect(() =>
			runSteps(state, 10_000, tuning, log, { absorbed: null, validate: true }),
		).not.toThrow();
		expect(state.tick).toBe(10_000);
	});

	test.each([
		["skips entries for ticks already passed", [assign(2, 1, "farm")], 0],
		["applies entries for the tick being produced", [assign(6, 1, "farm")], 1],
	])("when resuming at tick 5 it %s", (_name, log, farmers) => {
		const state = createNewGame(42, tuning);
		state.tick = 5;

		runSteps(state, 3, tuning, log, quietOptions);

		expect(laborCounts(state.posting.delegates).farm).toBe(farmers);
	});

	test("applies same-tick entries in file order", () => {
		const log = [
			assign(1, 1, "farm"),
			assign(1, 1, "idle"),
			assign(1, 1, "mine"),
		];
		const state = createNewGame(42, tuning);

		runSteps(state, 1, tuning, log, quietOptions);

		expect(laborCounts(state.posting.delegates)).toEqual({
			farm: 0,
			forest: 0,
			mine: 1,
		});
	});
});
