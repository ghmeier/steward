import type { CliRenderer, KeyEvent } from "@opentui/core";
import { errorMessage } from "../core/errors";
import { createNewGame, type GameState } from "../core/state";
import type { Tuning } from "../core/tuning";
import { loadGame, saveGame } from "../save/save";
import { courtMenu } from "./court-menu";
import { type Cursor, moveCursor, reconcileCursor } from "./cursor";
import { decreeMenu } from "./decree-menu";
import { helpMenu } from "./help-menu";
import { actionForKey, HINTS_TEXT, isInterrupt } from "./keys";
import { type MenuState, menuKey, openMenu, renderMenu } from "./menu";
import { createPanels } from "./panels";
import { createSession } from "./session";

const FRAME_INTERVAL_MS = 50;
const AUTOSAVE_INTERVAL_MS = 30_000;

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
	let cursor: Cursor | null = reconcileCursor(session.view().delegates, null);

	let menu: MenuState | null = null;
	let promotionAnnounced = session.view().promotion.promotedAt > 0;

	const menuContext = () => ({ view: session.view(), tuning });
	const composeFooter = () => {
		const hints =
			menu === null ? HINTS_TEXT : renderMenu(menu, menuContext()).hints;
		return `${message ?? ""}\n${hints}`;
	};
	const redraw = () => {
		footer = composeFooter();
		const view = session.view();
		cursor = reconcileCursor(view.delegates, cursor);
		panels.update(view, footer, cursor?.id ?? null);
		panels.showMenu(menu === null ? null : renderMenu(menu, menuContext()));
		renderer.requestRender();
	};

	// Returns the failure instead of throwing so key handlers and timers can never crash the app.
	const save = (): string | null => {
		try {
			saveGame(saveDir, session.state);
			return null;
		} catch (error) {
			return errorMessage(error);
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
		if (menu !== null && !isInterrupt(key)) {
			const result = menuKey(menu, key, menuContext());
			menu = result.state;
			for (const command of result.commands) session.enqueue(command);
			redraw();
			return;
		}
		const action = actionForKey(key);
		if (action === null) return;
		if (action.kind === "decrees") {
			menu = openMenu(decreeMenu);
			redraw();
			return;
		}
		if (action.kind === "court") {
			menu = openMenu(courtMenu);
			redraw();
			return;
		}
		if (action.kind === "help") {
			menu = openMenu(helpMenu);
			redraw();
			return;
		}
		if (action.kind === "move") {
			cursor = moveCursor(session.view().delegates, cursor, action.delta);
			redraw();
		} else if (action.kind === "assign") {
			if (cursor === null) message = "No peasant is selected.";
			else {
				session.enqueue({
					type: "assignPeasant",
					peasant: cursor.id,
					job: action.job,
				});
				return;
			}
			redraw();
		} else if (action.kind === "save") saveAndAnnounce(true);
		else void shutdown();
	};

	function frame(): void {
		if (finalExit !== null) return;
		const result = session.frame();
		const lastRejection = result.rejections.at(-1);
		if (lastRejection !== undefined) message = lastRejection.reason;
		if (!promotionAnnounced && session.view().promotion.promotedAt > 0) {
			promotionAnnounced = true;
			message = "The crown has noticed you. You are promoted to steward.";
		}
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
