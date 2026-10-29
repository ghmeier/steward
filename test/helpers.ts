import tuningJson from "../data/tuning.json";
import villageJson from "../data/village.json";
import type { CommandLogEntry } from "../src/core/commands";
import type { Delegate } from "../src/core/delegates";
import type { AddContext } from "../src/core/math";
import { createNewGame, type GameState } from "../src/core/state";
import { parseTuning, type Tuning } from "../src/core/tuning";

export const tuning = parseTuning({ ...tuningJson, village: villageJson });

// Balancing edits data/tuning.json, so tests that assert hand-computed economy numbers use these literals.
export const economyTestTuning: Tuning = {
	stepMs: 100,
	maxResourceValue: 1e300,
	decrees: { maxRules: 4, maxConditionNodes: 8, maxConditionDepth: 3 },
	economy: {
		ticksPerSeason: 600,
		seasonYield: { autumn: 1, spring: 1, summer: 1.5, winter: 0 },
		grainPerFarmer: 0.025,
		woodPerWorker: 0.02,
		orePerWorker: 0.01,
		grainPerPerson: 0.01,
		starvationHunger: 2,
		grainPrice: 0.5,
		grainPerPeasant: 30,
		maxPopulation: 40,
		laborMovesPerTick: 1,
		initialPopulation: 10,
		initialResources: { coin: 0, grain: 60, ore: 0, wood: 0 },
		laborAllocations: {
			balanced: { farm: 0.5, forest: 0.3, mine: 0.2 },
			farming: { farm: 0.7, forest: 0.2, mine: 0.1 },
		},
	},
	village: {
		names: villageJson.names,
		deskSlots: 3,
		promotionPopulation: 12,
		disputeArrival: { minTicks: 900, maxTicks: 1800 },
		grudgeTicks: 600,
		disputes: [
			{
				id: "boundary",
				text: "{first} accuses {second} of moving a stone.",
				options: [
					{ id: "pay", label: "Pay the surveyor", resources: { coin: -10 } },
					{
						id: "for-first",
						label: "Rule for {first}",
						resources: { grain: 5 },
						grudge: "second",
					},
					{
						id: "for-second",
						label: "Rule for {second}",
						grudge: "first",
					},
				],
				expiry: "pay",
			},
			{
				id: "hen",
				text: "{second} kept {first}'s hen.",
				options: [
					{ id: "buy", label: "Buy a hen", resources: { grain: -10 } },
					{ id: "dismiss", label: "Dismiss it" },
				],
				expiry: "buy",
			},
		],
	},
};

export const sampleCommandLog: CommandLogEntry[] = [
	...[1, 2, 3, 4, 5, 6, 7].map(
		(peasant): CommandLogEntry => ({
			tick: peasant,
			command: { type: "assignPeasant", peasant, job: "farm" },
		}),
	),
	{
		tick: 8,
		command: { type: "assignPeasant", peasant: 8, job: "forest" },
	},
	{
		tick: 9,
		command: { type: "assignPeasant", peasant: 9, job: "forest" },
	},
	{
		tick: 10,
		command: { type: "assignPeasant", peasant: 10, job: "mine" },
	},
	{
		tick: 11,
		command: { type: "assignPeasant", peasant: 1, job: "farm" },
	},
	{ tick: 100, command: { type: "noop" } },
	{
		tick: 3000,
		command: { type: "assignPeasant", peasant: 1, job: "idle" },
	},
	{
		tick: 3001,
		command: { type: "assignPeasant", peasant: 1, job: "forest" },
	},
];

export const quietOptions = { absorbed: null, validate: false } as const;

export type RosterCounts = {
	farm?: number;
	forest?: number;
	mine?: number;
	idle?: number;
};

/** Ids ascend in the order farm, forest, mine, idle, so lowest-id expectations are easy to state. */
export function rosterOf(counts: RosterCounts): Delegate[] {
	const jobs = ["farm", "forest", "mine", "idle"] as const;
	const delegates: Delegate[] = [];
	for (const job of jobs) {
		for (let i = 0; i < (counts[job] ?? 0); i++) {
			const id = delegates.length + 1;
			delegates.push({
				id,
				name: villageJson.names[id - 1] as string,
				kind: "peasant",
				job,
				grudgeUntil: 0,
			});
		}
	}
	return delegates;
}

export function setRoster(state: GameState, counts: RosterCounts): void {
	state.posting.delegates = rosterOf(counts);
	state.posting.nextDelegateId = state.posting.delegates.length + 1;
}

export function contextFor(state: GameState): AddContext {
	return { tick: state.tick, maxValue: 1e300, absorbed: null };
}

/** The ten-peasant village the sample command log was written for, so the desk and multi-peasant labor stay covered. */
export function sampleVillage(seed: number): GameState {
	const state = createNewGame(seed, tuning);
	setRoster(state, { idle: 10 });
	return state;
}
