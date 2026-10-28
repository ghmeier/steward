import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { type CommandLogEntry, parseCommandLog } from "../core/commands";
import type { AbsorbedAdditionLog } from "../core/math";
import { createNewGame, type GameState } from "../core/state";
import { runSteps } from "../core/step";
import type { Tuning } from "../core/tuning";
import { loadTuning } from "../save/content";
import { stateHash } from "../save/hash";
import { readSaveFile, writeSaveFile } from "../save/save";

export type SimIo = {
	stdout(line: string): void;
	stderr(line: string): void;
};

export type SimDependencies = { tuning?: Tuning };

const USAGE = `usage: bun run sim (--seed <uint32> | --load <path>) --steps <n> [options]

  --seed <uint32>    start a new game with this seed
  --load <path>      continue the save file at this path
  --steps <n>        number of steps to run (0 loads and re-saves)
  --commands <path>  JSON command log to replay
  --out <path>       write the final save to this file
  --trace <n>        print a trace line every n steps
  --strategy <file>  reserved for phase 3`;

class UsageError extends Error {}

function parseCount(text: string, name: string, minimum: number): number {
	const value = Number(text);
	if (!/^\d+$/.test(text) || !Number.isSafeInteger(value) || value < minimum) {
		throw new UsageError(`${name} must be an integer of at least ${minimum}`);
	}
	return value;
}

function sortedRecord<T>(record: Record<string, T>): Record<string, T> {
	const sorted: Record<string, T> = {};
	const keys = Object.keys(record).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
	for (const key of keys) sorted[key] = record[key] as T;
	return sorted;
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

type Options = {
	seed: number | null;
	load: string | null;
	steps: number;
	commands: string | null;
	out: string | null;
	trace: number | null;
};

function parseOptions(argv: string[]): Options {
	let values: Record<string, string | boolean | undefined>;
	try {
		({ values } = parseArgs({
			args: argv,
			strict: true,
			allowPositionals: false,
			options: {
				seed: { type: "string" },
				load: { type: "string" },
				steps: { type: "string" },
				commands: { type: "string" },
				out: { type: "string" },
				trace: { type: "string" },
				strategy: { type: "string" },
			},
		}));
	} catch (error) {
		throw new UsageError(describeError(error));
	}

	if (values.strategy !== undefined) {
		throw new UsageError("--strategy is not available until phase 3");
	}
	const seedText = values.seed as string | undefined;
	const load = values.load as string | undefined;
	if ((seedText === undefined) === (load === undefined)) {
		throw new UsageError("exactly one of --seed and --load is required");
	}
	const stepsText = values.steps as string | undefined;
	if (stepsText === undefined) throw new UsageError("--steps is required");
	const seed =
		seedText === undefined ? null : parseCount(seedText, "--seed", 0);
	if (seed !== null && seed > 0xffffffff) {
		throw new UsageError("--seed must be a uint32");
	}
	const traceText = values.trace as string | undefined;
	return {
		seed,
		load: load ?? null,
		steps: parseCount(stepsText, "--steps", 0),
		commands: (values.commands as string | undefined) ?? null,
		out: (values.out as string | undefined) ?? null,
		trace: traceText === undefined ? null : parseCount(traceText, "--trace", 1),
	};
}

function reportError(io: SimIo, tick: number | null, error: unknown): number {
	io.stderr(
		JSON.stringify({ type: "error", tick, message: describeError(error) }),
	);
	return 1;
}

export function runSim(
	argv: string[],
	io: SimIo,
	dependencies: SimDependencies = {},
): number {
	let options: Options;
	try {
		options = parseOptions(argv);
	} catch (error) {
		if (!(error instanceof UsageError)) throw error;
		io.stderr(`error: ${error.message}`);
		io.stderr(USAGE);
		return 2;
	}

	let tuning: Tuning;
	let state: GameState;
	let log: CommandLogEntry[] = [];
	try {
		tuning = dependencies.tuning ?? loadTuning();
		state =
			options.load !== null
				? readSaveFile(options.load).state
				: createNewGame(options.seed as number, tuning);
		if (options.commands !== null) {
			log = parseCommandLog(JSON.parse(readFileSync(options.commands, "utf8")));
		}
	} catch (error) {
		return reportError(io, null, error);
	}

	const absorbed: AbsorbedAdditionLog = {};
	const rejectedCommands: { tick: number; type: string; reason: string }[] = [];
	let stepsDone = 0;
	try {
		runSteps(
			state,
			options.steps,
			tuning,
			log,
			{ validate: true, absorbed },
			(tick, commands, results) => {
				for (const [index, result] of results.entries()) {
					if (!result.ok) {
						rejectedCommands.push({
							tick,
							type: commands[index]?.type ?? "unknown",
							reason: result.reason,
						});
					}
				}
				stepsDone += 1;
				if (options.trace !== null && stepsDone % options.trace === 0) {
					io.stdout(
						JSON.stringify({
							type: "trace",
							tick,
							hash: stateHash(state),
							resources: sortedRecord(state.posting.resources),
						}),
					);
				}
			},
		);
		if (options.out !== null) writeSaveFile(options.out, state);
	} catch (error) {
		return reportError(io, state.tick, error);
	}

	const sortedAbsorbed: AbsorbedAdditionLog = {};
	for (const [resource, entry] of Object.entries(sortedRecord(absorbed))) {
		sortedAbsorbed[resource] = {
			count: entry.count,
			firstTick: entry.firstTick,
		};
	}
	io.stdout(
		JSON.stringify({
			type: "summary",
			tick: state.tick,
			hash: stateHash(state),
			resources: sortedRecord(state.posting.resources),
			absorbed: sortedAbsorbed,
			rejectedCommands,
		}),
	);
	return 0;
}

if (import.meta.main) {
	const code = runSim(process.argv.slice(2), {
		stdout: (line) => console.log(line),
		stderr: (line) => console.error(line),
	});
	process.exit(code);
}
