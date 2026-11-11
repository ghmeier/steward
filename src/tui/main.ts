import { createCliRenderer } from "@opentui/core";
import { copy } from "../core/copy";
import { loadTuning } from "../save/content";
import { defaultSaveDir } from "../save/paths";
import { SAVE_FILE_NAME } from "../save/save";
import { prepareStartup, startApp } from "./app";

async function main(): Promise<number> {
  const tuning = loadTuning();
  const saveDir = defaultSaveDir();
  const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  const startup = prepareStartup(saveDir, tuning, newSeed);
  if (startup.kind === "refused") {
    console.error(
      copy.menus.cannotReadSave({
        error: startup.error,
        path: `${saveDir}/${SAVE_FILE_NAME}`,
      }),
    );
    return 1;
  }

  // OpenTUI's default signal handlers destroy the renderer without saving, so the app owns the signals.
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    exitSignals: [],
    experimental_nativeInput: true,
  });
  try {
    const app = startApp({
      renderer,
      game: startup.game,
      tuning,
      saveDir,
      now: () => performance.now(),
      newSeed,
      notice: startup.notice,
    });
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.on(signal, () => void app.shutdown());
    }
    // The terminal is gone, so after renderer.destroy() the event loop spins on it and no timer
    // or promise continuation is guaranteed to run; save synchronously and exit at once.
    process.on("SIGHUP", () => {
      const { saveError } = app.hangUp();
      if (saveError !== null) {
        console.error(copy.menus.couldNotSave({ error: saveError }));
      }
      process.exit(saveError === null ? 0 : 1);
    });
    const exit = await app.done;
    if (exit.saveError !== null) {
      console.error(copy.menus.couldNotSave({ error: exit.saveError }));
      return 1;
    }
    return 0;
  } catch (error) {
    renderer.destroy();
    await renderer.closed;
    console.error(error);
    return 1;
  }
}

process.exit(await main());
