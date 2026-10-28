import { createNewGame } from "../../src/core/state";
import { loadTuning } from "../../src/save/content";
import { saveGame } from "../../src/save/save";

const [dir, seed] = process.argv.slice(2);
const state = createNewGame(Number(seed), loadTuning());
saveGame(
	dir as string,
	state,
	{ savedAt: "2026-01-02T00:00:00.000Z", contentHash: "child" },
	{ afterTempWrite: () => process.kill(process.pid, "SIGKILL") },
);
