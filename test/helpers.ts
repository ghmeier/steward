import tuningJson from "../data/tuning.json";
import type { CommandLogEntry } from "../src/core/commands";
import { parseTuning, type Tuning } from "../src/core/tuning";

export const tuning = parseTuning(tuningJson);

// Balancing edits data/tuning.json, so tests that assert hand-computed economy numbers use these literals.
export const economyTestTuning: Tuning = {
	stepMs: 100,
	maxResourceValue: 1e300,
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
};

export const sampleCommandLog: CommandLogEntry[] = [
	...Array.from(
		{ length: 7 },
		(_, index): CommandLogEntry => ({
			tick: index + 1,
			command: { type: "assignWorker", job: "farm", delta: 1 },
		}),
	),
	{ tick: 8, command: { type: "assignWorker", job: "forest", delta: 1 } },
	{ tick: 9, command: { type: "assignWorker", job: "forest", delta: 1 } },
	{ tick: 10, command: { type: "assignWorker", job: "mine", delta: 1 } },
	{ tick: 11, command: { type: "assignWorker", job: "farm", delta: 1 } },
	{ tick: 100, command: { type: "noop" } },
	{ tick: 3000, command: { type: "assignWorker", job: "farm", delta: -1 } },
	{ tick: 3001, command: { type: "assignWorker", job: "forest", delta: 1 } },
];

export const quietOptions = { absorbed: null, validate: false } as const;
