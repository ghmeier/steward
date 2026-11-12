import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { emptyCrownState } from "../core/crown";
import { isRecord } from "../core/data";
import { errorMessage } from "../core/errors";
import { Game } from "../core/game";
import { emptyIllusionState } from "../core/illusion";
import { NO_LABOR_POLICY } from "../core/labor";
import { seedStream } from "../core/rng";
import { canonicalStringify } from "../core/serialize";
import { type GameState, SCHEMA_VERSION } from "../core/state";
import { CONJURING, CROWN_PANEL } from "../core/unlocks";
import { assertValidState } from "../core/validate";
import { contentHash, loadTuning } from "./content";

export const SAVE_FILE_NAME = "save.json";

export type SaveFile = {
  schemaVersion: number;
  savedAt: string;
  contentHash: string;
  state: GameState;
};

export class SaveVersionError extends Error {
  readonly foundVersion: unknown;

  constructor(foundVersion: unknown) {
    super(
      `save schemaVersion ${String(foundVersion)} is not supported (expected ${SCHEMA_VERSION})`,
    );
    this.name = "SaveVersionError";
    this.foundVersion = foundVersion;
  }
}

type SaveMeta = { savedAt: string; contentHash: string };

export function serializeSave(state: GameState, meta: SaveMeta): string {
  assertValidState(state);
  const save: SaveFile = {
    schemaVersion: state.schemaVersion,
    savedAt: meta.savedAt,
    contentHash: meta.contentHash,
    state,
  };
  return canonicalStringify(save);
}

/** Each entry rewrites a save of the keyed version, in place, into the next version. */
const UPGRADES: Record<number, (state: Record<string, unknown>) => void> = {
  // Version 8 moved labor every tick, so its first upgraded tick must read as a policy change.
  8: (state) => {
    if (!isRecord(state.posting)) return;
    state.posting.labor = { policy: NO_LABOR_POLICY, settling: false };
  },
  // A save that already passed promotion would never reach the promotion check again, so it is
  // given the Crown panel and its first demand here.
  9: (state) => {
    if (!isRecord(state.posting) || !isRecord(state.career)) return;
    const crown = emptyCrownState();
    state.posting.crown = crown;
    if (isRecord(state.posting.rng)) {
      state.posting.rng.crown = seedStream(Number(state.posting.seed), "crown");
    }
    if (
      typeof state.career.promotedAt === "number" &&
      state.career.promotedAt !== 0 &&
      isRecord(state.career.unlocks)
    ) {
      state.career.unlocks[CROWN_PANEL] = state.tick as number;
      crown.nextDemandTick =
        (state.tick as number) + loadTuning().crown.firstDemand.minTicks;
    }
  },
  // Every desk entry before version 11 was a dispute.
  10: (state) => {
    if (!isRecord(state.posting) || !isRecord(state.posting.desk)) return;
    const { disputes } = state.posting.desk;
    if (!Array.isArray(disputes)) return;
    for (const entry of disputes) {
      if (isRecord(entry)) entry.kind = "dispute";
    }
  },
  // A crown that has already issued a demand would never reach the first-demand grant again.
  11: (state) => {
    if (!isRecord(state.posting)) return;
    state.posting.illusion = emptyIllusionState();
    const { crown } = state.posting;
    if (!isRecord(crown) || !isRecord(crown.demand)) return;
    const issued =
      crown.demand.id !== 0 ||
      (crown.met as number) + (crown.missed as number) > 0;
    if (issued && isRecord(state.career) && isRecord(state.career.unlocks)) {
      state.career.unlocks[CONJURING] = state.tick as number;
    }
  },
  // Favor starts neutral for every crown, including one that has already made demands.
  12: (state) => {
    if (!isRecord(state.posting) || !isRecord(state.posting.crown)) return;
    state.posting.crown.favor = 0;
  },
  // Governors arrive after promotion, so a save has none; it gains an empty record of former staff and its own random stream.
  // The career's list of former staff was never read, so it is dropped in favor of the posting's record.
  13: (state) => {
    if (isRecord(state.career)) delete state.career.formerStaff;
    if (!isRecord(state.posting)) return;
    state.posting.formerStaff = [];
    if (isRecord(state.posting.rng)) {
      state.posting.rng.governors = seedStream(
        Number(state.posting.seed),
        "governors",
      );
    }
    if (!Array.isArray(state.posting.delegates)) return;
    for (const delegate of state.posting.delegates) {
      if (isRecord(delegate)) delegate.kind ??= "peasant";
    }
  },
  // Villages were unnamed before version 15, so an old save is given the default its own seed picks.
  14: (state) => {
    if (!isRecord(state.posting)) return;
    state.posting.name = Game.defaultVillageName(
      Number(state.posting.seed),
      loadTuning(),
    );
  },
};

function upgrade(record: Record<string, unknown>): void {
  while (typeof record.schemaVersion === "number") {
    const step = Object.hasOwn(UPGRADES, record.schemaVersion)
      ? UPGRADES[record.schemaVersion]
      : undefined;
    if (step === undefined) return;
    if (isRecord(record.state)) {
      step(record.state);
      record.state.schemaVersion = record.schemaVersion + 1;
    }
    record.schemaVersion += 1;
  }
}

export function parseSave(text: string): SaveFile {
  const record: unknown = JSON.parse(text);
  if (!isRecord(record)) throw new Error("save must be a JSON object");
  upgrade(record);
  if (record.schemaVersion !== SCHEMA_VERSION) {
    throw new SaveVersionError(record.schemaVersion);
  }
  if (typeof record.savedAt !== "string") {
    throw new Error("save.savedAt must be a string");
  }
  if (typeof record.contentHash !== "string") {
    throw new Error("save.contentHash must be a string");
  }
  assertValidState(record.state);
  return {
    schemaVersion: record.schemaVersion,
    savedAt: record.savedAt,
    contentHash: record.contentHash,
    state: record.state,
  };
}

const RETRYABLE_RENAME_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Windows refuses to rename a file that antivirus or an indexer has briefly open and reports
// it as EPERM, EBUSY, or EACCES; the lock clears within milliseconds, so retry before failing.
function renameWithRetry(from: string, to: string): void {
  for (let attempt = 1; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 5 || !code || !RETRYABLE_RENAME_CODES.has(code)) {
        throw error;
      }
      sleepSync(10 * attempt);
    }
  }
}

function writeFileDurably(path: string, text: string): void {
  const fd = openSync(path, "w");
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function fsyncDirectory(dir: string): void {
  if (process.platform === "win32") return;
  const fd = openSync(dir, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function writeSaveFile(
  path: string,
  state: GameState,
  meta: Partial<SaveMeta> = {},
  hooks: { afterTempWrite?: () => void } = {},
): void {
  const text = serializeSave(state, {
    savedAt: meta.savedAt ?? new Date().toISOString(),
    contentHash: meta.contentHash ?? contentHash(),
  });

  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tempPath = `${path}.tmp`;
  const backupPath = `${path}.bak`;

  writeFileDurably(tempPath, text);
  hooks.afterTempWrite?.();

  if (existsSync(path)) {
    // Windows will not rename over an existing file.
    if (process.platform === "win32") rmSync(backupPath, { force: true });
    renameWithRetry(path, backupPath);
  }
  renameWithRetry(tempPath, path);
  fsyncDirectory(dir);
}

export function saveGame(
  dir: string,
  state: GameState,
  meta: Partial<SaveMeta> = {},
  hooks: { afterTempWrite?: () => void } = {},
): string {
  const savePath = join(dir, SAVE_FILE_NAME);
  writeSaveFile(savePath, state, meta, hooks);
  return savePath;
}

export type LoadResult =
  | { kind: "loaded"; save: SaveFile }
  | { kind: "missing" }
  | { kind: "versionRefused"; foundVersion: unknown; preservedAs: string }
  | { kind: "invalid"; error: string };

function firstFreeVersionPath(dir: string, foundVersion: unknown): string {
  const label = String(foundVersion).replace(/[^A-Za-z0-9_-]/g, "_");
  let candidate = join(dir, `save.v${label}.json`);
  for (let n = 1; existsSync(candidate); n++) {
    candidate = join(dir, `save.v${label}.${n}.json`);
  }
  return candidate;
}

export function loadGame(dir: string): LoadResult {
  const savePath = join(dir, SAVE_FILE_NAME);
  let text: string;
  try {
    text = readFileSync(savePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { kind: "missing" };
    }
    return { kind: "invalid", error: String(error) };
  }

  try {
    return { kind: "loaded", save: parseSave(text) };
  } catch (error) {
    if (error instanceof SaveVersionError) {
      const preservedAs = firstFreeVersionPath(dir, error.foundVersion);
      renameWithRetry(savePath, preservedAs);
      return {
        kind: "versionRefused",
        foundVersion: error.foundVersion,
        preservedAs,
      };
    }
    return { kind: "invalid", error: errorMessage(error) };
  }
}

export function readSaveFile(path: string): SaveFile {
  return parseSave(readFileSync(path, "utf8"));
}
