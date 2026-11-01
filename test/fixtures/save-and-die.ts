import { Game } from "../../src/core/game";
import { loadTuning } from "../../src/save/content";
import { saveGame } from "../../src/save/save";

const [dir, seed] = process.argv.slice(2);
const game = Game.create(Number(seed), loadTuning());
saveGame(
  dir as string,
  game.state,
  { savedAt: "2026-01-02T00:00:00.000Z", contentHash: "child" },
  { afterTempWrite: () => process.kill(process.pid, "SIGKILL") },
);
