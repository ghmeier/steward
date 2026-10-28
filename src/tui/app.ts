import type { CliRenderer, KeyEvent } from "@opentui/core";
import { createNewGame, type GameState } from "../core/state";
import type { Tuning } from "../core/tuning";
import { loadGame, saveGame } from "../save/save";
import { actionForKey, KEY_HINTS } from "./keys";
import { createPanels } from "./panels";
import { createSession } from "./session";

export const FRAME_INTERVAL_MS = 50;
export const AUTOSAVE_INTERVAL_MS = 30_000;

export type Startup =
	| { kind: "ready"; state: GameState; notice: string | null }
	| { kind: "refused"; error: string };

export function prepareStartup(
	saveDir: string,
	tuning: Tuning,
	newSeed: () => number,
): Startup {
	const result = loadGame(saveDir);
	switch (result.kind) {
		case "loaded":
			return { kind: "ready", state: result.save.state, notice: null };
		case "missing":
			return {
				kind: "ready",
				state: createNewGame(newSeed(), tuning),
				notice: "Started a new game.",
			};
		case "versionRefused":
			return {
				kind: "ready",
				state: createNewGame(newSeed(), tuning),
				notice: `Save version ${String(result.foundVersion)} is not supported; it was kept as ${result.preservedAs}. Started a new game.`,
			};
		case "invalid":
			// Starting anyway would let an autosave overwrite a save the player may want to recover.
			return { kind: "refused", error: result.error };
	}
}

export type AppExit = { saveError: string | null };
export type App = {
	frame(): void;
	shutdown(): Promise<AppExit>;
	hangUp(): AppExit;
	readonly done: Promise<AppExit>;
};

const HINTS_TEXT = KEY_HINTS.map((hint) => `${hint.keys} ${hint.label}`).join(
	" · ",
);

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function startApp(options: {
	renderer: CliRenderer;
	state: GameState;
	tuning: Tuning;
	saveDir: string;
	now: () => number;
	notice: string | null;
	frameIntervalMs?: number;
	autosaveIntervalMs?: number;
}): App {
	const { renderer, tuning, saveDir } = options;
	const session = createSession({
		state: options.state,
		tuning,
		now: options.now,
	});
	const panels = createPanels(renderer);
	let message = options.notice;
	let footer = "";

	const composeFooter = () =>
		message === null ? HINTS_TEXT : `${HINTS_TEXT}  ${message}`;
	const redraw = () => {
		footer = composeFooter();
		panels.update(session.view(), footer);
		renderer.requestRender();
	};

	// Returns the failure instead of throwing so key handlers and timers can never crash the app.
	const save = (): string | null => {
		try {
			saveGame(saveDir, session.state);
			return null;
		} catch (error) {
			return errorText(error);
		}
	};
	const saveAndAnnounce = (announceSuccess: boolean) => {
		const error = save();
		if (error !== null) message = `Save failed: ${error}`;
		else if (announceSuccess) message = "Saved.";
		else return;
		redraw();
	};

	let frameTimer: ReturnType<typeof setInterval> | undefined;
	let autosaveTimer: ReturnType<typeof setInterval> | undefined;
	let shutdownPromise: Promise<AppExit> | null = null;
	let finalExit: AppExit | null = null;
	let resolveDone: (exit: AppExit) => void = () => {};
	const done = new Promise<AppExit>((resolve) => {
		resolveDone = resolve;
	});
	const onKeyPress = (key: KeyEvent) => {
		const action = actionForKey(key);
		if (action === null) return;
		if (action.kind === "command") session.enqueue(action.command);
		else if (action.kind === "save") saveAndAnnounce(true);
		else void shutdown();
	};

	function frame(): void {
		if (finalExit !== null) return;
		const result = session.frame();
		const lastRejection = result.rejections.at(-1);
		if (lastRejection !== undefined) message = lastRejection.reason;
		if (result.viewChanged || composeFooter() !== footer) redraw();
	}

	// Shared by shutdown and hangUp so the two paths save at most once between them.
	function stopAndSave(): AppExit {
		if (finalExit === null) {
			clearInterval(frameTimer);
			clearInterval(autosaveTimer);
			renderer.keyInput.off("keypress", onKeyPress);
			finalExit = { saveError: save() };
		}
		return finalExit;
	}

	function hangUp(): AppExit {
		return stopAndSave();
	}

	function shutdown(): Promise<AppExit> {
		shutdownPromise ??= (async () => {
			const exit = stopAndSave();
			renderer.destroy();
			await renderer.closed;
			resolveDone(exit);
			return exit;
		})();
		return shutdownPromise;
	}

	renderer.keyInput.on("keypress", onKeyPress);
	redraw();
	// Started last so a failure in the initial draw cannot leave timers running that nothing can stop.
	frameTimer = setInterval(
		() => frame(),
		options.frameIntervalMs ?? FRAME_INTERVAL_MS,
	);
	autosaveTimer = setInterval(
		() => saveAndAnnounce(false),
		options.autosaveIntervalMs ?? AUTOSAVE_INTERVAL_MS,
	);

	return {
		frame,
		shutdown,
		hangUp,
		done,
	};
}
