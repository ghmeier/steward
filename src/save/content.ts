import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { compareKeys } from "../core/data";
import { parseTuning, type Tuning } from "../core/tuning";

export const DEFAULT_DATA_DIR = resolve(import.meta.dir, "..", "..", "data");

/** The data file behind each tuning section; the sections not listed here sit at the top level of `tuning.json`. */
export const TUNING_SECTION_FILES = {
  village: "village.json",
  desk: "desk.json",
  archive: "archive.json",
  crown: "crown.json",
  illusion: "illusion.json",
  governors: "governors.json",
} as const;

/** The merged, unparsed contents of every tuning data file. */
export function readTuningJson(dataDir: string = DEFAULT_DATA_DIR): object {
  const read = (file: string): unknown =>
    JSON.parse(readFileSync(join(dataDir, file), "utf8"));
  const sections = Object.fromEntries(
    Object.entries(TUNING_SECTION_FILES).map(([section, file]) => [
      section,
      read(file),
    ]),
  );
  return { ...(read("tuning.json") as object), ...sections };
}

export function loadTuning(dataDir: string = DEFAULT_DATA_DIR): Tuning {
  return parseTuning(readTuningJson(dataDir));
}

function listFiles(root: string, relativeDir: string, out: string[]): void {
  const entries = readdirSync(join(root, relativeDir), { withFileTypes: true });
  for (const entry of entries) {
    const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) listFiles(root, relative, out);
    else if (entry.isFile()) out.push(relative);
  }
}

// Recorded in each save so a replay that diverges after a content edit explains itself.
// The path and length framing makes a rename or a move of bytes between files change the hash.
export function contentHash(dataDir: string = DEFAULT_DATA_DIR): string {
  const files: string[] = [];
  listFiles(dataDir, "", files);
  files.sort(compareKeys);

  const hasher = new Bun.CryptoHasher("sha256");
  const nul = new Uint8Array([0]);
  for (const file of files) {
    const bytes = readFileSync(join(dataDir, file));
    hasher.update(file);
    hasher.update(nul);
    hasher.update(String(bytes.length));
    hasher.update(nul);
    hasher.update(bytes);
  }
  return hasher.digest("hex");
}
