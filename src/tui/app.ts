import type { CliRenderer, KeyEvent } from "@opentui/core";
import { errorMessage } from "../core/errors";
import { Game } from "../core/game";
import type { Tuning } from "../core/tuning";
import { loadGame, saveGame } from "../save/save";
import { type LineState, lineKey, openLine, renderLine } from "./command-line";
import { crownNotice } from "./crown-notices";
import { deskNotice } from "./desk-notices";
import { HelpPage } from "./help-menu";
import { actionForKey, type FocusId, FocusRing, isInterrupt } from "./keys";
import { type MenuState, menuKey, openMenu, renderMenu } from "./menu";
import { newGameMenu } from "./new-game-menu";
import { BAR_LINES, createPanels } from "./panels";
import { Session } from "./session";
import { starvationNotice } from "./starvation-notice";
import { announceNewUnlocks } from "./unlock-notices";
import { type PanelStep, Village } from "./village-panels";

const FRAME_INTERVAL_MS = 50;
const AUTOSAVE_INTERVAL_MS = 30_000;

export type Startup =
  | { kind: "ready"; game: Game; notice: string | null }
  | { kind: "refused"; error: string };

export function prepareStartup(
  saveDir: string,
  tuning: Tuning,
  newSeed: () => number,
): Startup {
  const result = loadGame(saveDir);
  switch (result.kind) {
    case "loaded": {
      const game = Game.fromState(result.save.state, tuning);
      const repealed = game.decrees.repealStale();
      return {
        kind: "ready",
        game,
        notice:
          repealed.length === 0
            ? null
            : `Repealed ${repealed.join(", ")}: their policies no longer exist.`,
      };
    }
    case "missing":
      return {
        kind: "ready",
        game: Game.create(newSeed(), tuning),
        notice: "Started a new game.",
      };
    case "versionRefused":
      return {
        kind: "ready",
        game: Game.create(newSeed(), tuning),
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
  game: Game;
  tuning: Tuning;
  saveDir: string;
  now: () => number;
  newSeed: () => number;
  notice: string | null;
  frameIntervalMs?: number;
  autosaveIntervalMs?: number;
}): App {
  const { renderer, tuning, saveDir } = options;
  const makeSession = (game: Game): Session =>
    new Session(game, { now: options.now });
  let session = makeSession(options.game);
  const village = new Village();
  const panels = createPanels(renderer, village);
  let message = options.notice;
  let drawnMessage = message;
  village.peasants.reset(session.view());
  let focus: FocusId | null = null;

  let menu: MenuState | null = null;
  let help: HelpPage | null = null;
  let line: LineState | null = null;
  let promotionAnnounced = session.view().promotion.promotedAt > 0;
  let lastView = session.view();
  let knownUnlocks = new Set(lastView.unlocks);

  const menuContext = () => ({ view: session.view(), tuning });
  // Help is reference text that fills the screen, so its scroll window is the whole grid area.
  const helpViewport = () => ({
    width: Math.max(1, renderer.width - 4),
    height: Math.max(1, renderer.height - BAR_LINES - 2),
  });
  const currentOverlay = () => {
    if (help !== null) return help.render(menuContext(), helpViewport());
    return menu === null ? null : renderMenu(menu, menuContext());
  };
  const redraw = () => {
    drawnMessage = message;
    const view = session.view();
    village.peasants.reconcile(view);
    panels.update({
      context: menuContext(),
      message,
      focus,
    });
    panels.showOverlay(currentOverlay());
    panels.showLine(
      line === null
        ? null
        : renderLine(line, menuContext(), panels.lineSuggestionBudget),
    );
    renderer.requestRender();
  };

  // Returns the failure instead of throwing so key handlers and timers can never crash the app.
  const save = (): string | null => {
    try {
      saveGame(saveDir, session.game.state);
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

  const foundNewVillage = () => {
    session = makeSession(Game.create(options.newSeed(), tuning));
    lastView = session.view();
    promotionAnnounced = lastView.promotion.promotedAt > 0;
    knownUnlocks = new Set(lastView.unlocks);
    village.peasants.reset(lastView);
    focus = null;
    const error = save();
    message =
      error === null ? "A new village is founded." : `Save failed: ${error}`;
  };

  let frameTimer: ReturnType<typeof setInterval> | undefined;
  let autosaveTimer: ReturnType<typeof setInterval> | undefined;
  let shutdownPromise: Promise<AppExit> | null = null;
  let finalExit: AppExit | null = null;
  let resolveDone: (exit: AppExit) => void = () => {};
  const done = new Promise<AppExit>((resolve) => {
    resolveDone = resolve;
  });
  const applyPanelStep = (result: PanelStep) => {
    for (const command of result.commands) session.enqueue(command);
    for (const request of result.requests) {
      if (request.kind === "unfocus") focus = null;
      else if (request.kind === "openLine") line = openLine(request.text);
      else message = request.text;
    }
  };
  const onKeyPress = (key: KeyEvent) => {
    if (line !== null && !isInterrupt(key)) {
      const result = lineKey(line, key, menuContext());
      line = result.state;
      for (const command of result.commands) session.enqueue(command);
      redraw();
      return;
    }
    if (help !== null && !isInterrupt(key)) {
      if (!help.key(key, menuContext(), helpViewport())) help = null;
      redraw();
      return;
    }
    if (menu !== null && !isInterrupt(key)) {
      const result = menuKey(menu, key, menuContext());
      menu = result.state;
      for (const command of result.commands) session.enqueue(command);
      if (result.requests.includes("newGame")) foundNewVillage();
      redraw();
      return;
    }
    if (focus !== null && !isInterrupt(key)) {
      const result = village.focusable[focus].key(key, menuContext());
      if (result !== null) {
        applyPanelStep(result);
        redraw();
        return;
      }
    }
    const action = actionForKey(key, session.view().unlocks);
    if (action === null) return;
    if (action.kind === "focus" || action.kind === "cycle") {
      focus = new FocusRing(session.view().unlocks).target(action, focus);
      village.focusable[focus].enter(menuContext());
      redraw();
    } else if (action.kind === "line") {
      line = openLine(action.prefill);
      redraw();
    } else if (action.kind === "newGame") {
      menu = openMenu(newGameMenu);
      redraw();
    } else if (action.kind === "help") {
      help = new HelpPage();
      redraw();
    } else if (action.kind === "save") saveAndAnnounce(true);
    else void shutdown();
  };

  function frame(): void {
    if (finalExit !== null) return;
    const result = session.frame();
    const lastRejection = result.rejections.at(-1);
    if (lastRejection !== undefined) message = lastRejection.reason;
    const starved = starvationNotice(lastView, session.view());
    if (starved !== null) message = starved;
    const deskChange = deskNotice(lastView, session.view());
    if (deskChange !== null) message = deskChange;
    const crown = crownNotice(lastView.crown, session.view().crown, tuning);
    if (crown !== null) message = crown;
    lastView = session.view();
    const unlocked = announceNewUnlocks(
      knownUnlocks,
      session.view().unlocks,
      tuning,
    );
    if (unlocked !== null) message = unlocked;
    if (!promotionAnnounced && session.view().promotion.promotedAt > 0) {
      promotionAnnounced = true;
      message = "The crown has noticed you. You are promoted to steward.";
    }
    if (result.viewChanged || message !== drawnMessage) redraw();
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
