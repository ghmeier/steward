import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { CommandLogEntry } from "../core/commands";
import { sortedKeys } from "../core/data";
import { errorMessage, InvalidStateError } from "../core/errors";
import { Game } from "../core/game";
import type { AbsorbedAdditionLog } from "../core/math";
import type { Tuning } from "../core/tuning";
import { loadTuning } from "../save/content";
import { stateHash } from "../save/hash";
import { readSaveFile, writeSaveFile } from "../save/save";
import { parseStrategy, StrategyPlayer } from "./strategy";

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
  --validate-every <n>
                     validate the state every n steps (default: once per season,
                     and always once after the last step); 1 finds the exact
                     tick a state went bad
  --strategy <path>  JSON strategy file to play (excludes --commands)
  --record <path>    with --strategy, write the issued commands as a command log
  --grant <ids>      testing aid, only with --seed: comma-separated unlock ids
                     written into the career at tick 0`;

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
  validateEvery: number | null;
  strategy: string | null;
  record: string | null;
  grant: string[];
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
        "validate-every": { type: "string" },
        strategy: { type: "string" },
        record: { type: "string" },
        grant: { type: "string" },
      },
    }).values;
  } catch (error) {
    throw new UsageError(errorMessage(error));
  }
}

function parseOptions(argv: string[]): Options {
  const flags = parseFlags(argv);
  if (flags.strategy !== undefined && flags.commands !== undefined) {
    throw new UsageError("--strategy and --commands are mutually exclusive");
  }
  if (flags.record !== undefined && flags.strategy === undefined) {
    throw new UsageError("--record requires --strategy");
  }
  if ((flags.seed === undefined) === (flags.load === undefined)) {
    throw new UsageError("exactly one of --seed and --load is required");
  }
  if (flags.grant !== undefined && flags.seed === undefined) {
    throw new UsageError("--grant requires --seed");
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
    validateEvery:
      flags["validate-every"] === undefined
        ? null
        : parseCount(flags["validate-every"], "--validate-every", 1),
    strategy: flags.strategy ?? null,
    record: flags.record ?? null,
    grant: flags.grant === undefined ? [] : flags.grant.split(","),
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
  let game: Game;
  let log: CommandLogEntry[] = [];
  let player: StrategyPlayer | null = null;
  let strategyName = "";
  try {
    tuning = dependencies.tuning ?? loadTuning();
    game =
      options.load !== null
        ? Game.fromState(readSaveFile(options.load).state, tuning)
        : Game.create(options.seed as number, tuning);
    if (options.load !== null) {
      const repealed = game.decrees.repealStale();
      if (repealed.length > 0) {
        io.stderr(
          `repealed decrees whose policies no longer exist: ${repealed.join(", ")}`,
        );
      }
    }
    const known = new Set([
      ...tuning.archive.entries.map((entry) => entry.id),
      ...tuning.archive.play.map((unlock) => unlock.id),
    ]);
    for (const id of options.grant) {
      if (!known.has(id)) throw new Error(`--grant: unknown unlock id "${id}"`);
      game.state.career.unlocks[id] = 0;
    }
    if (options.commands !== null) {
      log = game.commands.parseCommandLog(
        JSON.parse(readFileSync(options.commands, "utf8")),
      );
    }
    if (options.strategy !== null) {
      const strategy = parseStrategy(
        JSON.parse(readFileSync(options.strategy, "utf8")),
        tuning.decrees,
      );
      strategyName = strategy.name;
      player = new StrategyPlayer(strategy);
    }
  } catch (error) {
    return reportError(io, null, error);
  }

  const { state } = game;
  const absorbed: AbsorbedAdditionLog = {};
  const rejectedCommands: { tick: number; type: string; reason: string }[] = [];
  const issued: CommandLogEntry[] = [];
  let minPopulation = game.delegates.population;
  const crownOutcomes: { tick: number; outcome: "met" | "missed" }[] = [];
  let crownMet = state.posting.crown.met;
  let crownMissed = state.posting.crown.missed;
  let peakDebt = 0;
  let stepsDone = 0;
  const commandSource = player === null ? undefined : player.next.bind(player);
  // A full schema parse of the state costs far more than the step it checks, so validating every step dominates long runs.
  const validateEvery = options.validateEvery ?? tuning.economy.ticksPerSeason;
  try {
    game.steps.runSteps(
      options.steps,
      log,
      { validateEvery, absorbed },
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
        if (options.record !== null) {
          for (const command of commands) issued.push({ tick, command });
        }
        const { met, missed } = state.posting.crown;
        if (met > crownMet) crownOutcomes.push({ tick, outcome: "met" });
        if (missed > crownMissed)
          crownOutcomes.push({ tick, outcome: "missed" });
        peakDebt = Math.max(peakDebt, game.illusion.debtValue);
        crownMet = met;
        crownMissed = missed;
        player?.observe(game);
        minPopulation = Math.min(minPopulation, game.delegates.population);
        stepsDone += 1;
        if (options.trace !== null && stepsDone % options.trace === 0) {
          io.stdout(
            JSON.stringify({
              type: "trace",
              tick,
              hash: stateHash(state),
              resources: sortedRecord(state.posting.resources),
              population: game.delegates.population,
              starved: state.posting.economy.starved,
            }),
          );
        }
      },
      commandSource,
    );
    game.steps.validate();
    if (options.out !== null) writeSaveFile(options.out, state);
    if (options.record !== null) {
      writeFileSync(options.record, `${JSON.stringify(issued, null, "\t")}\n`);
    }
  } catch (error) {
    if (error instanceof InvalidStateError && validateEvery > 1) {
      error.message += ` (validated every ${validateEvery} steps; rerun with --validate-every 1 to find the first invalid tick)`;
    }
    return reportError(io, state.tick, error);
  }

  io.stdout(
    JSON.stringify({
      type: "summary",
      tick: state.tick,
      hash: stateHash(state),
      resources: sortedRecord(state.posting.resources),
      population: game.delegates.population,
      starved: state.posting.economy.starved,
      minPopulation,
      promotedAt: state.career.promotedAt,
      crown: {
        met: state.posting.crown.met,
        missed: state.posting.crown.missed,
        favor: state.posting.crown.favor,
        outcomes: crownOutcomes,
      },
      illusion: {
        conjured: game.illusion.conjuredValue,
        debt: game.illusion.debtValue,
        peakDebt,
        audits: state.posting.illusion.audits,
      },
      ...(player
        ? { strategy: { name: strategyName, ...player.stats() } }
        : {}),
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
