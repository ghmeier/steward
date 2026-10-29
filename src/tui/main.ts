import { createCliRenderer } from "@opentui/core";
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
			`Steward cannot read its save: ${startup.error}\nThe save at ${saveDir}/${SAVE_FILE_NAME} was left untouched. Fix or move it, then start again.`,
		);
		return 1;
	}

	// OpenTUI's default signal handlers destroy the renderer without saving, so the app owns the signals.
	const renderer = await createCliRenderer({
		exitOnCtrlC: false,
		exitSignals: [],
	});
	try {
		const app = startApp({
			renderer,
			state: startup.state,
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
				console.error(`Could not save the game: ${saveError}`);
			}
			process.exit(saveError === null ? 0 : 1);
		});
		const exit = await app.done;
		if (exit.saveError !== null) {
			console.error(`Could not save the game: ${exit.saveError}`);
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
