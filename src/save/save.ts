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
import { join } from "node:path";
import { canonicalStringify } from "../core/serialize";
import { type GameState, SCHEMA_VERSION } from "../core/state";
import { assertValidState } from "../core/validate";
import { contentHash } from "./content";

export const SAVE_FILE_NAME = "save.json";
const TEMP_FILE_NAME = "save.json.tmp";
const BACKUP_FILE_NAME = "save.json.bak";

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

export function serializeSave(
	state: GameState,
	meta: { savedAt: string; contentHash: string },
): string {
	assertValidState(state);
	const save: SaveFile = {
		schemaVersion: state.schemaVersion,
		savedAt: meta.savedAt,
		contentHash: meta.contentHash,
		state,
	};
	return canonicalStringify(save);
}

export function parseSave(text: string): SaveFile {
	const parsed: unknown = JSON.parse(text);
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error("save must be a JSON object");
	}
	const record = parsed as Record<string, unknown>;
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

export function saveGame(
	dir: string,
	state: GameState,
	meta: Partial<{ savedAt: string; contentHash: string }> = {},
	hooks: { afterTempWrite?: () => void } = {},
): string {
	const text = serializeSave(state, {
		savedAt: meta.savedAt ?? new Date().toISOString(),
		contentHash: meta.contentHash ?? contentHash(),
	});

	mkdirSync(dir, { recursive: true });
	const savePath = join(dir, SAVE_FILE_NAME);
	const tempPath = join(dir, TEMP_FILE_NAME);
	const backupPath = join(dir, BACKUP_FILE_NAME);

	writeFileDurably(tempPath, text);
	hooks.afterTempWrite?.();

	if (existsSync(savePath)) {
		// Windows will not rename over an existing file.
		if (process.platform === "win32") rmSync(backupPath, { force: true });
		renameWithRetry(savePath, backupPath);
	}
	renameWithRetry(tempPath, savePath);
	fsyncDirectory(dir);
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
		return {
			kind: "invalid",
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export function readSaveFile(path: string): SaveFile {
	return parseSave(readFileSync(path, "utf8"));
}
