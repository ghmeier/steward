import tuningJson from "../data/tuning.json";
import type { CommandLogEntry } from "../src/core/commands";
import { parseTuning } from "../src/core/tuning";

export const tuning = parseTuning(tuningJson);

export const sampleCommandLog: CommandLogEntry[] = [
	{ tick: 1, command: { type: "setToyRate", growthPerTick: 2.25 } },
	{ tick: 100, command: { type: "noop" } },
	{ tick: 100, command: { type: "setToyRate", growthPerTick: 0.5 } },
	{ tick: 4999, command: { type: "setToyRate", growthPerTick: 3 } },
	{ tick: 5000, command: { type: "setToyRate", growthPerTick: 1.125 } },
	{ tick: 5001, command: { type: "setToyRate", growthPerTick: 7.75 } },
	{ tick: 8000, command: { type: "setToyRate", growthPerTick: 0.25 } },
];

export const quietOptions = { absorbed: null, validate: false } as const;
