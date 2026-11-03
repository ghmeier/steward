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
import { isRecord } from "../core/data";
import { errorMessage } from "../core/errors";
import { NO_LABOR_POLICY } from "../core/labor";
import { canonicalStringify } from "../core/serialize";
import { type GameState, SCHEMA_VERSION } from "../core/state";
import { assertValidState } from "../core/validate";
import { contentHash } from "./content";

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

/**
 * Each entry rewrites a save of the keyed version, in place, into the next version. Version 8 had
 * no labor settling state; an empty policy makes the first tick read as a phase change, which
 * matches how those saves behaved before.
 */
const UPGRADES: Record<number, (state: Record<string, unknown>) => void> = {
  8: (state) => {
    if (!isRecord(state.posting)) return;
    state.posting.labor = { policy: NO_LABOR_POLICY, settling: false };
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
