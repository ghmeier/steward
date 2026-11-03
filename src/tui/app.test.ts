import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createTestRenderer } from "@opentui/core/testing";
import {
  grantUnlocks,
  quietOptions,
  setFamineDue,
  setRoster,
  tuning,
} from "../../test/helpers";
import type { Decree } from "../core/decree";
import { Game } from "../core/game";
import { Job } from "../core/realm";
import { ARCHIVE_PANEL, PALETTE_UNLOCK } from "../core/unlocks";
import { stateHash } from "../save/hash";
import { readSaveFile, SAVE_FILE_NAME, saveGame } from "../save/save";
import { type App, prepareStartup, type Startup, startApp } from "./app";
import { ARCHIVE_OPENS } from "./unlock-notices";

const NEVER_MS = 1e9;
const NEW_SEED = 321;
const dirs: string[] = [];
const apps: App[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.shutdown();
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "steward-app-"));
  dirs.push(dir);
  return dir;
}

function savedHash(dir: string): string {
  return stateHash(readSaveFile(join(dir, SAVE_FILE_NAME)).state);
}

async function launch(
  options: {
    saveDir?: string;
    notice?: string | null;
    kittyKeyboard?: boolean;
    game?: Game;
  } = {},
) {
  const saveDir = options.saveDir ?? tempDir();
  const setup = await createTestRenderer({
    width: 120,
    height: 30,
    exitOnCtrlC: false,
    kittyKeyboard: options.kittyKeyboard ?? false,
  });
  const game = options.game ?? Game.create(5, tuning);
  let nowMs = 0;
  const app = startApp({
    renderer: setup.renderer,
    game,
    tuning,
    saveDir,
    now: () => nowMs,
    newSeed: () => NEW_SEED,
    notice: options.notice ?? null,
    frameIntervalMs: NEVER_MS,
    autosaveIntervalMs: NEVER_MS,
  });
  apps.push(app);
  app.frame();
  let renders = 0;
  const requestRender = setup.renderer.requestRender.bind(setup.renderer);
  setup.renderer.requestRender = () => {
    renders++;
    requestRender();
  };
  let destroys = 0;
  let savedWhenDestroyed: string | null = null;
  const destroy = setup.renderer.destroy.bind(setup.renderer);
  setup.renderer.destroy = () => {
    const path = join(saveDir, SAVE_FILE_NAME);
    destroys++;
    savedWhenDestroyed = existsSync(path) ? savedHash(saveDir) : null;
    destroy();
  };
  return {
    app,
    destroyCalls: () => destroys,
    savedWhenDestroyed: () => savedWhenDestroyed,
    game,
    saveDir,
    renders: () => renders,
    mockInput: setup.mockInput,
    async advanceStep() {
      nowMs += tuning.stepMs;
      app.frame();
      await setup.renderOnce();
    },
    async screen() {
      await setup.renderOnce();
      return setup.captureCharFrame();
    },
  };
}

describe("prepareStartup", () => {
  const ready = (startup: Startup) => {
    if (startup.kind !== "ready") throw new Error("startup was refused");
    return startup;
  };

  test("a missing save starts a new game from the injected seed with a notice", () => {
    const startup = ready(prepareStartup(tempDir(), tuning, () => 42));

    expect(stateHash(startup.game.state)).toBe(
      stateHash(Game.create(42, tuning).state),
    );
    expect(startup.notice).not.toBeNull();
  });

  test("a saved game loads with the same state hash and no notice", () => {
    const dir = tempDir();
    const saved = { ...Game.create(5, tuning).state, tick: 12 };
    saveGame(dir, saved);

    const startup = ready(prepareStartup(dir, tuning, () => 1));

    expect(stateHash(startup.game.state)).toBe(stateHash(saved));
    expect(startup.notice).toBeNull();
  });

  test("a save of an unsupported version starts a new game and names the preserved file", () => {
    const dir = tempDir();
    const old = { schemaVersion: 0, savedAt: "", contentHash: "", state: {} };
    writeFileSync(join(dir, SAVE_FILE_NAME), JSON.stringify(old));

    const startup = ready(prepareStartup(dir, tuning, () => 42));

    const preserved = join(dir, "save.v0.json");
    expect(existsSync(preserved)).toBe(true);
    expect(startup.notice).toContain(preserved);
    expect(stateHash(startup.game.state)).toBe(
      stateHash(Game.create(42, tuning).state),
    );
  });

  test("a save with a decree on a removed labor policy loads without it, says so, and keeps stepping", () => {
    const dir = tempDir();
    const saved = Game.create(5, tuning).state;
    saved.posting.decrees.workers = {
      id: "workers",
      petition: "labor",
      rules: [],
      otherwise: "foraging",
    };
    saveGame(dir, saved);

    const startup = ready(prepareStartup(dir, tuning, () => 1));

    expect(startup.game.state.posting.decrees.workers).toBeUndefined();
    expect(startup.notice).toContain("workers");
    expect(() => startup.game.steps.step([], quietOptions)).not.toThrow();
  });

  test("an invalid save is refused and left byte for byte unchanged", () => {
    const path = join(tempDir(), SAVE_FILE_NAME);
    writeFileSync(path, "{ not json");

    const startup = prepareStartup(dirname(path), tuning, () => 1);

    expect(startup.kind).toBe("refused");
    expect(readFileSync(path, "utf8")).toBe("{ not json");
  });
});

const withRoster = (peasants: number): Game => {
  const game = Game.create(5, tuning);
  setRoster(game, { idle: peasants });
  return game;
};
const owning = (...ids: string[]): Game => {
  const game = Game.create(5, tuning);
  grantUnlocks(game, ids);
  return game;
};
type Harness = Awaited<ReturnType<typeof launch>>;
const everyoneIdle = (harness: Harness) =>
  harness.game.state.posting.delegates.every((p) => p.job === Job.IDLE);
const savedState = (harness: Harness, file = SAVE_FILE_NAME) =>
  readSaveFile(join(harness.saveDir, file)).state;

describe("lifecycle", () => {
  test("the first frame shows every panel title and the startup notice", async () => {
    const harness = await launch({ notice: "Started a new game." });

    const screen = await harness.screen();

    for (const title of [
      "(L)edger",
      "(P)easants",
      "(A)rchive",
      "(C)ourt",
      "(D)ecrees",
    ]) {
      expect(screen).toContain(title);
    }
    expect(screen).toContain("Started a new game.");
  });

  test("assignment keys act on the peasant under the cursor, a repeat shows the rejection and s saves", async () => {
    const harness = await launch({ game: withRoster(3) });

    await harness.mockInput.typeText("pjmm");
    await harness.advanceStep();
    const screen = await harness.screen();
    await harness.mockInput.typeText("s");

    const [first, second] = harness.game.state.posting.delegates;
    expect(first?.job).toBe(Job.IDLE);
    expect(second?.job).toBe(Job.MINE);
    expect(screen).toContain(`${second?.name} already works`);
    expect(screen).toMatch(new RegExp(`> ${second?.name} {2}mine`));
    expect(stateHash(savedState(harness))).toBe(stateHash(harness.game.state));
  });

  test.each([
    ["q", (input: Harness["mockInput"]) => input.pressKey("q")],
    ["Ctrl-C", (input: Harness["mockInput"]) => input.pressCtrlC()],
  ])(
    "pressing %s saves the current state and finishes the app",
    async (_name, press) => {
      const harness = await launch();
      await harness.mockInput.typeText("pf");
      await harness.advanceStep();

      press(harness.mockInput);
      const exit = await harness.app.done;

      expect(exit.saveError).toBeNull();
      expect(savedHash(harness.saveDir)).toBe(stateHash(harness.game.state));
      expect(harness.savedWhenDestroyed()).toBe(stateHash(harness.game.state));
    },
  );

  test("hangUp saves the live state without touching the renderer, and later frames do nothing", async () => {
    const harness = await launch();
    await harness.mockInput.typeText("pf");
    await harness.advanceStep();

    const exit = harness.app.hangUp();
    const tickBefore = harness.game.state.tick;
    await harness.advanceStep();

    expect(exit.saveError).toBeNull();
    expect(savedHash(harness.saveDir)).toBe(stateHash(harness.game.state));
    expect(harness.destroyCalls()).toBe(0);
    expect(harness.game.state.tick).toBe(tickBefore);
  });

  test.each([
    [
      "hangUp after a completed shutdown",
      async (app: App) => {
        await app.shutdown();
        app.hangUp();
      },
    ],
    [
      "shutdown called twice",
      async (app: App) => {
        const first = app.shutdown();
        expect(app.shutdown()).toBe(first);
        await first;
      },
    ],
  ])("%s saves once", async (_name, act) => {
    const harness = await launch();
    saveGame(harness.saveDir, Game.create(5, tuning).state);

    await act(harness.app);

    expect(stateHash(savedState(harness, `${SAVE_FILE_NAME}.bak`))).toBe(
      stateHash(Game.create(5, tuning).state),
    );
  });

  test("a failing save shows in the footer, keeps the app running and is reported at exit", async () => {
    const blocker = join(tempDir(), "not-a-directory");
    writeFileSync(blocker, "");
    const harness = await launch({ saveDir: blocker });

    await harness.mockInput.typeText("s");
    await harness.advanceStep();
    const screen = await harness.screen();
    const exit = await harness.app.shutdown();

    expect(screen).toContain("Save failed");
    expect(exit.saveError).not.toBeNull();
    expect(harness.app.hangUp().saveError).not.toBeNull();
  });
});

describe("rendering", () => {
  test("a frame that runs no step does not request a render", async () => {
    const harness = await launch();
    const before = harness.renders();

    harness.app.frame();

    expect(harness.renders()).toBe(before);
  });
});

const dispute = {
  id: 1,
  template: "stolen-hen",
  parties: [1, 2] as [number, number],
  arrivedAt: 0,
};
const withDispute = (): Game => {
  const game = withRoster(2);
  game.state.posting.desk.disputes = [dispute];
  game.state.posting.desk.nextDisputeId = 2;
  return game;
};
const granary: Decree = {
  id: "granary",
  petition: "harvest",
  rules: [],
  otherwise: "sell",
};
const DOUBLE_BORDER = "\u2554";

describe("doors", () => {
  test("enter in the Decrees panel opens the command line on the selected petition and a typed decree reaches the state", async () => {
    const harness = await launch();

    await harness.mockInput.typeText("dj");
    harness.mockInput.pressEnter();
    const open = await harness.screen();
    await harness.mockInput.typeText(
      "sell when coin above 5 otherwise stockpile",
    );
    harness.mockInput.pressEnter();
    await harness.advanceStep();

    expect(open).toContain(": decree wood _");
    expect(open).not.toContain("(L)edger");
    expect(Object.keys(harness.game.state.posting.decrees)).toEqual(["wood"]);
    expect(await harness.screen()).toContain("(L)edger");
  });

  test("with the line open game keys do not assign, but Ctrl-C still quits", async () => {
    const harness = await launch({ game: owning(PALETTE_UNLOCK) });

    await harness.mockInput.typeText("p:f");
    await harness.advanceStep();
    harness.mockInput.pressCtrlC();
    await harness.app.done;

    expect(everyoneIdle(harness)).toBe(true);
    expect(harness.destroyCalls()).toBe(1);
  });

  test("? opens one help page with every topic, game keys scroll it instead of acting, and escape closes it", async () => {
    const harness = await launch({ kittyKeyboard: true });

    await harness.mockInput.typeText("?");
    const open = await harness.screen();
    await harness.mockInput.typeText("pf");
    harness.mockInput.pressEscape();

    expect(open).toContain("KEYS");
    expect(open).toContain("GRAIN AND GROWTH");
    expect(everyoneIdle(harness)).toBe(true);
    expect(await harness.screen()).toContain("(L)edger");
  });

  test("help scrolls a line with j, a page with space, and back with k", async () => {
    const harness = await launch();

    await harness.mockInput.typeText("?");
    const top = await harness.screen();
    await harness.mockInput.typeText("j");
    const oneLine = await harness.screen();
    await harness.mockInput.typeText("k");
    const back = await harness.screen();
    await harness.mockInput.typeText(" ");
    const page = await harness.screen();

    expect(top).toContain("KEYS");
    expect(oneLine).not.toContain("KEYS");
    expect(back).toContain("KEYS");
    expect(page).not.toContain("KEYS");
    expect(page).toContain("COIN");
  });

  test("? closes the help page it opened", async () => {
    const harness = await launch({ kittyKeyboard: true });

    await harness.mockInput.typeText("??");

    expect(await harness.screen()).toContain("(L)edger");
  });

  test("a focuses the Archive once the panel is owned and does nothing before", async () => {
    const locked = await launch();
    const owned = await launch({ game: owning(ARCHIVE_PANEL) });

    await locked.mockInput.typeText("a");
    await owned.mockInput.typeText("a");

    expect(await locked.screen()).not.toContain(DOUBLE_BORDER);
    expect(await owned.screen()).toContain(DOUBLE_BORDER);
  });

  test("colon opens the line once the palette is owned and does nothing before", async () => {
    const locked = await launch();
    const owned = await launch({ game: owning(PALETTE_UNLOCK) });

    await locked.mockInput.typeText(":");
    await owned.mockInput.typeText(":");

    expect(await locked.screen()).toContain("(L)edger");
    expect(await owned.screen()).toContain(": _");
  });
});

describe("focus", () => {
  test("a panel letter focuses its panel, another letter moves focus and escape clears it", async () => {
    const harness = await launch({ kittyKeyboard: true });

    await harness.mockInput.typeText("p");
    const peasants = await harness.screen();
    await harness.mockInput.typeText("c");
    const court = await harness.screen();
    harness.mockInput.pressEscape();
    const cleared = await harness.screen();

    expect(peasants).toMatch(/\u2554\S*\(P\)easants/);
    expect(court).toMatch(/\u2554\S*\(C\)ourt/);
    expect(court).not.toMatch(/\u2554\S*\(P\)easants/);
    expect(cleared).not.toContain(DOUBLE_BORDER);
  });

  test("l is not bound to the Ledger", async () => {
    const harness = await launch();

    await harness.mockInput.typeText("l");

    expect(await harness.screen()).not.toContain(DOUBLE_BORDER);
  });

  test("panel keys do nothing while their panel is not focused", async () => {
    const harness = await launch({ game: withDispute() });

    await harness.mockInput.typeText("fjx");
    harness.mockInput.pressEnter();
    await harness.advanceStep();

    expect(everyoneIdle(harness)).toBe(true);
    expect(harness.game.state.posting.desk.disputes).toHaveLength(1);
    expect(await harness.screen()).not.toContain(": decree");
  });

  test("assignment keys are ignored while another panel is focused", async () => {
    const harness = await launch();

    await harness.mockInput.typeText("cf");
    await harness.advanceStep();

    expect(everyoneIdle(harness)).toBe(true);
  });

  test("global keys still work while a panel is focused", async () => {
    const harness = await launch({ game: owning(PALETTE_UNLOCK) });

    await harness.mockInput.typeText("c:");

    expect(await harness.screen()).toContain(": _");
  });

  test("settling a dispute in the Court panel enqueues the ruling while the Ledger stays visible", async () => {
    const harness = await launch({ game: withDispute() });
    await harness.advanceStep();

    await harness.mockInput.typeText("c");
    harness.mockInput.pressEnter();
    await harness.mockInput.typeText("jj");
    const settling = await harness.screen();
    harness.mockInput.pressEnter();
    await harness.advanceStep();

    expect(settling).toContain("(L)edger");
    expect(settling).toContain(
      "Settle the dispute".length > 0 ? "will sulk" : "",
    );
    expect(harness.game.state.posting.desk.disputes).toEqual([]);
  });

  test("escape in the Court panel goes back a level before it leaves the panel", async () => {
    const harness = await launch({ game: withDispute(), kittyKeyboard: true });
    await harness.advanceStep();

    await harness.mockInput.typeText("c");
    harness.mockInput.pressEnter();
    harness.mockInput.pressEscape();
    const backAtList = await harness.screen();
    harness.mockInput.pressEscape();

    expect(backAtList).toContain(DOUBLE_BORDER);
    expect(await harness.screen()).not.toContain(DOUBLE_BORDER);
  });

  test("buying from the Archive panel spends the coin and owns the entry", async () => {
    const harness = await launch({ game: owning(ARCHIVE_PANEL) });
    const palette = tuning.archive.entries.find((e) => e.id === PALETTE_UNLOCK);
    harness.game.state.posting.resources.coin = (palette?.cost ?? 0) + 1;

    await harness.mockInput.typeText("a");
    harness.mockInput.pressEnter();
    await harness.advanceStep();

    expect(harness.game.state.career.unlocks[PALETTE_UNLOCK]).toBeDefined();
    expect(harness.game.state.posting.resources.coin).toBeLessThan(2);
    expect(await harness.screen()).toContain("owned");
  });

  test("x in the Decrees panel repeals the selected decree and says so when none is in force", async () => {
    const game = Game.create(5, tuning);
    game.decrees.enact(granary);
    const harness = await launch({ game });

    await harness.mockInput.typeText("dx");
    await harness.advanceStep();
    const repealed = harness.game.state.posting.decrees.granary;
    await harness.mockInput.typeText("x");

    expect(repealed).toBeUndefined();
    expect(await harness.screen()).toContain("No harvest decree is in force.");
  });

  test("the bar lists the palette only once it is owned", async () => {
    const locked = await launch();
    const owned = await launch({ game: owning(PALETTE_UNLOCK) });

    expect(await locked.screen()).not.toContain(": commands");
    expect(await owned.screen()).toContain(
      "(?)Help (N)ew village (Q)uit : commands",
    );
  });
});

describe("new village", () => {
  test("n asks for confirmation, warning about Archive purchases only once the player owns any", async () => {
    const withUnlocks = await launch({ game: owning(ARCHIVE_PANEL) });
    const plain = await launch();

    await withUnlocks.mockInput.typeText("n");
    await plain.mockInput.typeText("n");

    const screen = await plain.screen();
    expect(screen).toContain("Found a new village?");
    expect(screen).not.toContain("(L)edger");
    expect(screen).not.toContain("Archive");
    expect(await withUnlocks.screen()).toContain("bought in the Archive");
  });

  test("choosing yes backs up the old save, saves a new game at once and runs on its own state", async () => {
    const harness = await launch();
    await harness.mockInput.typeText("pf");
    await harness.advanceStep();
    saveGame(harness.saveDir, harness.game.state);
    const old = stateHash(harness.game.state);
    const oldTick = harness.game.state.tick;

    await harness.mockInput.typeText("nj");
    harness.mockInput.pressEnter();
    const founded = stateHash(savedState(harness));
    const backup = stateHash(savedState(harness, `${SAVE_FILE_NAME}.bak`));
    await harness.mockInput.typeText("pf");
    await harness.advanceStep();
    await harness.advanceStep();
    await harness.mockInput.typeText("s");

    expect(founded).toBe(stateHash(Game.create(NEW_SEED, tuning).state));
    expect(backup).toBe(old);
    expect(savedState(harness).posting.delegates[0]?.job).toBe(Job.FARM);
    expect(harness.game.state.tick).toBe(oldTick);
    expect(await harness.screen()).toContain("Saved.");
  });

  test.each([
    ["choosing no", (h: Harness) => h.mockInput.pressEnter()],
    ["escape", (h: Harness) => h.mockInput.pressEscape()],
  ])("%s leaves the game and the save untouched", async (_name, press) => {
    const harness = await launch({ kittyKeyboard: true });
    const before = stateHash(harness.game.state);

    await harness.mockInput.typeText("n");
    press(harness);

    expect(stateHash(harness.game.state)).toBe(before);
    expect(existsSync(join(harness.saveDir, SAVE_FILE_NAME))).toBe(false);
    expect(await harness.screen()).toContain("(L)edger");
  });
});

describe("notices", () => {
  const promotion = "The crown has noticed you. You are promoted to steward.";

  function nearlyPromoted(): Game {
    const game = Game.create(5, tuning);
    while (game.delegates.all.length < tuning.village.promotionPopulation) {
      game.delegates.create();
    }
    return game;
  }

  async function announcedThenLater(harness: Harness) {
    await harness.advanceStep();
    const announced = await harness.screen();
    await harness.mockInput.typeText("s");
    await harness.advanceStep();
    return { announced, later: await harness.screen() };
  }

  test("promotion during the session is announced once, but not for a save already promoted", async () => {
    const harness = await launch({ game: nearlyPromoted() });
    const promoted = nearlyPromoted();
    promoted.state.tick = 5;
    promoted.state.career.promotedAt = 3;
    const loaded = await launch({ game: promoted });

    const { announced, later } = await announcedThenLater(harness);
    await loaded.advanceStep();

    expect(announced).toContain(promotion);
    expect(later).not.toContain(promotion);
    expect(await loaded.screen()).not.toContain(promotion);
  });

  test("a starving peasant is named in the footer, and a fed village shows no notice", async () => {
    const game = Game.create(5, tuning);
    game.state.posting.resources.grain = 0;
    setFamineDue(game, 1, tuning.economy.ticksPerSeason);
    const first = game.state.posting.delegates[0]?.name as string;
    const starving = await launch({ game });
    const fed = await launch();

    await starving.advanceStep();
    await fed.advanceStep();

    expect(await starving.screen()).toContain(`${first} starved.`);
    expect(await fed.screen()).not.toContain("starved");
  });

  test("the Archive notice appears once when coin first appears, and not after a restart", async () => {
    const harness = await launch();
    harness.game.state.posting.resources.coin = 5;

    const { announced, later } = await announcedThenLater(harness);
    await harness.app.shutdown();
    const startup = prepareStartup(harness.saveDir, tuning, () => NEW_SEED);
    if (startup.kind !== "ready") throw new Error("save not loaded");
    const restarted = await launch({
      saveDir: harness.saveDir,
      game: startup.game,
    });
    await restarted.advanceStep();

    expect(announced).toContain(ARCHIVE_OPENS);
    expect(later).not.toContain(ARCHIVE_OPENS);
    expect(await restarted.screen()).not.toContain(ARCHIVE_OPENS);
  });

  test("a purchase is announced once", async () => {
    const harness = await launch({ game: owning(ARCHIVE_PANEL) });
    const palette = tuning.archive.entries.find((e) => e.id === PALETTE_UNLOCK);
    harness.game.state.posting.resources.coin = (palette?.cost ?? 0) + 1;

    await harness.mockInput.typeText("a");
    harness.mockInput.pressEnter();
    const { announced, later } = await announcedThenLater(harness);

    expect(announced).toContain(`Bought ${palette?.label}.`);
    expect(later).not.toContain("Bought");
  });
});
