import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { type CommandLogEntry, parseCommandLog } from "../core/commands";
import { sortedKeys } from "../core/data";
import { errorMessage } from "../core/errors";
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
	for (const key of sortedKeys(record)) sorted[key] = record[key] as T;
	return sorted;
}

type Options = {
	seed: number | null;
	load: string | null;
	steps: number;
	commands: string | null;
	out: string | null;
	trace: number | null;
};

function parseFlags(argv: string[]) {
	try {
		return parseArgs({
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
		}).values;
	} catch (error) {
		throw new UsageError(errorMessage(error));
	}
}

function parseOptions(argv: string[]): Options {
	const flags = parseFlags(argv);
	if (flags.strategy !== undefined) {
		throw new UsageError("--strategy is not available until phase 3");
	}
	if ((flags.seed === undefined) === (flags.load === undefined)) {
		throw new UsageError("exactly one of --seed and --load is required");
	}
	if (flags.steps === undefined) throw new UsageError("--steps is required");
	const seed =
		flags.seed === undefined ? null : parseCount(flags.seed, "--seed", 0);
	if (seed !== null && seed > 0xffffffff) {
		throw new UsageError("--seed must be a uint32");
	}
	return {
		seed,
		load: flags.load ?? null,
		steps: parseCount(flags.steps, "--steps", 0),
		commands: flags.commands ?? null,
		out: flags.out ?? null,
		trace:
			flags.trace === undefined ? null : parseCount(flags.trace, "--trace", 1),
	};
}

function reportError(io: SimIo, tick: number | null, error: unknown): number {
	io.stderr(
		JSON.stringify({ type: "error", tick, message: errorMessage(error) }),
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

	io.stdout(
		JSON.stringify({
			type: "summary",
			tick: state.tick,
			hash: stateHash(state),
			resources: sortedRecord(state.posting.resources),
			absorbed: sortedRecord(absorbed),
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
