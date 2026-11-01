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
import { bearPeasant } from "../src/core/delegates";
import { createNewGame, type GameState } from "../src/core/state";
import { ARCHIVE_PANEL, PALETTE_UNLOCK } from "../src/core/unlocks";
import { stateHash } from "../src/save/hash";
import { readSaveFile, SAVE_FILE_NAME, saveGame } from "../src/save/save";
import {
	type App,
	prepareStartup,
	type Startup,
	startApp,
} from "../src/tui/app";
import { ARCHIVE_OPENS } from "../src/tui/unlock-notices";
import { grantUnlocks, setFamineDue, setRoster, tuning } from "./helpers";

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
		state?: GameState;
	} = {},
) {
	const saveDir = options.saveDir ?? tempDir();
	const setup = await createTestRenderer({
		width: 120,
		height: 30,
		exitOnCtrlC: false,
		kittyKeyboard: options.kittyKeyboard ?? false,
	});
	const state: GameState = options.state ?? createNewGame(5, tuning);
	let nowMs = 0;
	const app = startApp({
		renderer: setup.renderer,
		state,
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
		state,
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

		expect(stateHash(startup.state)).toBe(stateHash(createNewGame(42, tuning)));
		expect(startup.notice).not.toBeNull();
	});

	test("a saved game loads with the same state hash and no notice", () => {
		const dir = tempDir();
		const saved = { ...createNewGame(9, tuning), tick: 12 };
		saveGame(dir, saved);

		const startup = ready(prepareStartup(dir, tuning, () => 1));

		expect(stateHash(startup.state)).toBe(stateHash(saved));
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
		expect(stateHash(startup.state)).toBe(stateHash(createNewGame(42, tuning)));
	});

	test("an invalid save is refused and left byte for byte unchanged", () => {
		const path = join(tempDir(), SAVE_FILE_NAME);
		writeFileSync(path, "{ not json");

		const startup = prepareStartup(dirname(path), tuning, () => 1);

		expect(startup.kind).toBe("refused");
		expect(readFileSync(path, "utf8")).toBe("{ not json");
	});
});

const withRoster = (peasants: number): GameState => {
	const state = createNewGame(5, tuning);
	setRoster(state, { idle: peasants });
	return state;
};
const owning = (...ids: string[]): GameState => {
	const state = createNewGame(5, tuning);
	grantUnlocks(state, ids);
	return state;
};
type Harness = Awaited<ReturnType<typeof launch>>;
const everyoneIdle = (harness: Harness) =>
	harness.state.posting.delegates.every((p) => p.job === "idle");
const savedState = (harness: Harness, file = SAVE_FILE_NAME) =>
	readSaveFile(join(harness.saveDir, file)).state;

describe("lifecycle", () => {
	test("the first frame shows every panel title and the startup notice", async () => {
		const harness = await launch({ notice: "Started a new game." });

		const screen = await harness.screen();

		for (const title of ["Ledger", "Crown", "Desk", "Peasants"]) {
			expect(screen).toContain(title);
		}
		expect(screen).toContain("Started a new game.");
	});

	test("assignment keys act on the peasant under the cursor, a repeat shows the rejection and s saves", async () => {
		const harness = await launch({ state: withRoster(3) });

		await harness.mockInput.typeText("jmm");
		await harness.advanceStep();
		const screen = await harness.screen();
		await harness.mockInput.typeText("s");

		const [first, second] = harness.state.posting.delegates;
		expect(first?.job).toBe("idle");
		expect(second?.job).toBe("mine");
		expect(screen).toContain(`${second?.name} already works`);
		expect(screen).toMatch(new RegExp(`> ${second?.name} {2}mine`));
		expect(stateHash(savedState(harness))).toBe(stateHash(harness.state));
	});

	test.each([
		["q", (input: Harness["mockInput"]) => input.pressKey("q")],
		["Ctrl-C", (input: Harness["mockInput"]) => input.pressCtrlC()],
	])(
		"pressing %s saves the current state and finishes the app",
		async (_name, press) => {
			const harness = await launch();
			await harness.mockInput.typeText("f");
			await harness.advanceStep();

			press(harness.mockInput);
			const exit = await harness.app.done;

			expect(exit.saveError).toBeNull();
			expect(savedHash(harness.saveDir)).toBe(stateHash(harness.state));
			expect(harness.savedWhenDestroyed()).toBe(stateHash(harness.state));
		},
	);

	test("hangUp saves the live state without touching the renderer, and later frames do nothing", async () => {
		const harness = await launch();
		await harness.mockInput.typeText("f");
		await harness.advanceStep();

		const exit = harness.app.hangUp();
		const tickBefore = harness.state.tick;
		await harness.advanceStep();

		expect(exit.saveError).toBeNull();
		expect(savedHash(harness.saveDir)).toBe(stateHash(harness.state));
		expect(harness.destroyCalls()).toBe(0);
		expect(harness.state.tick).toBe(tickBefore);
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
		saveGame(harness.saveDir, createNewGame(77, tuning));

		await act(harness.app);

		expect(stateHash(savedState(harness, `${SAVE_FILE_NAME}.bak`))).toBe(
			stateHash(createNewGame(77, tuning)),
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

describe("doors", () => {
	test("d opens the command line in place of the panels and a typed decree reaches the state", async () => {
		const harness = await launch();

		await harness.mockInput.typeText("d");
		const open = await harness.screen();
		await harness.mockInput.typeText(
			"wood sell when coin above 5 otherwise stockpile",
		);
		harness.mockInput.pressEnter();
		await harness.advanceStep();

		expect(open).toContain(": decree _");
		expect(open).not.toContain("Ledger");
		expect(Object.keys(harness.state.posting.decrees)).toEqual(["wood"]);
		expect(await harness.screen()).toContain("Ledger");
	});

	test("with the line open game keys do not assign, but Ctrl-C still quits", async () => {
		const harness = await launch();

		await harness.mockInput.typeText("df");
		await harness.advanceStep();
		harness.mockInput.pressCtrlC();
		await harness.app.done;

		expect(everyoneIdle(harness)).toBe(true);
		expect(harness.destroyCalls()).toBe(1);
	});

	test("c opens the court menu and settling the dispute removes it from the state", async () => {
		const harness = await launch({ state: withRoster(2) });
		harness.state.posting.desk.disputes = [
			{ id: 1, template: "stolen-hen", parties: [1, 2], arrivedAt: 0 },
		];
		harness.state.posting.desk.nextDisputeId = 2;
		await harness.advanceStep();

		await harness.mockInput.typeText("c");
		const open = await harness.screen();
		harness.mockInput.pressEnter();
		await harness.mockInput.typeText("jj");
		harness.mockInput.pressEnter();
		await harness.advanceStep();

		expect(open).toContain("Hold court");
		expect(open).not.toContain("Ledger");
		expect(harness.state.posting.desk.disputes).toEqual([]);
	});

	test("? opens help, game keys are routed to it, and escape backs out step by step", async () => {
		const harness = await launch({ kittyKeyboard: true });

		await harness.mockInput.typeText("?");
		const open = await harness.screen();
		await harness.mockInput.typeText("f");
		harness.mockInput.pressEnter();
		const topic = await harness.screen();
		harness.mockInput.pressEscape();
		harness.mockInput.pressEscape();

		expect(open).toContain("Grain and growth");
		expect(topic).toContain("Back");
		expect(everyoneIdle(harness)).toBe(true);
		expect(await harness.screen()).toContain("Ledger");
	});

	test.each([
		["a", ARCHIVE_PANEL, ": buy _"],
		[":", PALETTE_UNLOCK, ": _"],
	])(
		"%s opens the line once its unlock is owned and does nothing before",
		async (pressed, unlock, line) => {
			const locked = await launch();
			const owned = await launch({ state: owning(unlock) });

			await locked.mockInput.typeText(pressed);
			await owned.mockInput.typeText(pressed);

			expect(await locked.screen()).toContain("Ledger");
			expect(await owned.screen()).toContain(line);
		},
	);
});

describe("new village", () => {
	test("n asks for confirmation, warning about Archive purchases only once the player owns any", async () => {
		const withUnlocks = await launch({ state: owning(ARCHIVE_PANEL) });
		const plain = await launch();

		await withUnlocks.mockInput.typeText("n");
		await plain.mockInput.typeText("n");

		const screen = await plain.screen();
		expect(screen).toContain("Found a new village?");
		expect(screen).not.toContain("Ledger");
		expect(screen).not.toContain("Archive");
		expect(await withUnlocks.screen()).toContain("bought in the Archive");
	});

	test("choosing yes backs up the old save, saves a new game at once and runs on its own state", async () => {
		const harness = await launch();
		await harness.mockInput.typeText("f");
		await harness.advanceStep();
		saveGame(harness.saveDir, harness.state);
		const old = stateHash(harness.state);
		const oldTick = harness.state.tick;

		await harness.mockInput.typeText("nj");
		harness.mockInput.pressEnter();
		const founded = stateHash(savedState(harness));
		const backup = stateHash(savedState(harness, `${SAVE_FILE_NAME}.bak`));
		await harness.mockInput.typeText("f");
		await harness.advanceStep();
		await harness.advanceStep();
		await harness.mockInput.typeText("s");

		expect(founded).toBe(stateHash(createNewGame(NEW_SEED, tuning)));
		expect(backup).toBe(old);
		expect(savedState(harness).posting.delegates[0]?.job).toBe("farm");
		expect(harness.state.tick).toBe(oldTick);
		expect(await harness.screen()).toContain("Saved.");
	});

	test.each([
		["choosing no", (h: Harness) => h.mockInput.pressEnter()],
		["escape", (h: Harness) => h.mockInput.pressEscape()],
	])("%s leaves the game and the save untouched", async (_name, press) => {
		const harness = await launch({ kittyKeyboard: true });
		const before = stateHash(harness.state);

		await harness.mockInput.typeText("n");
		press(harness);

		expect(stateHash(harness.state)).toBe(before);
		expect(existsSync(join(harness.saveDir, SAVE_FILE_NAME))).toBe(false);
		expect(await harness.screen()).toContain("Ledger");
	});
});

describe("notices", () => {
	const promotion = "The crown has noticed you. You are promoted to steward.";

	function nearlyPromoted(): GameState {
		const state = createNewGame(5, tuning);
		while (
			state.posting.delegates.length < tuning.village.promotionPopulation
		) {
			bearPeasant(state.posting, tuning.village.names);
		}
		return state;
	}

	async function announcedThenLater(harness: Harness) {
		await harness.advanceStep();
		const announced = await harness.screen();
		await harness.mockInput.typeText("s");
		await harness.advanceStep();
		return { announced, later: await harness.screen() };
	}

	test("promotion during the session is announced once, but not for a save already promoted", async () => {
		const harness = await launch({ state: nearlyPromoted() });
		const promoted = nearlyPromoted();
		promoted.tick = 5;
		promoted.career.promotedAt = 3;
		const loaded = await launch({ state: promoted });

		const { announced, later } = await announcedThenLater(harness);
		await loaded.advanceStep();

		expect(announced).toContain(promotion);
		expect(later).not.toContain(promotion);
		expect(await loaded.screen()).not.toContain(promotion);
	});

	test("a starving peasant is named in the footer, and a fed village shows no notice", async () => {
		const state = createNewGame(5, tuning);
		state.posting.resources.grain = 0;
		setFamineDue(state, 1, tuning.economy.ticksPerSeason);
		const first = state.posting.delegates[0]?.name as string;
		const starving = await launch({ state });
		const fed = await launch();

		await starving.advanceStep();
		await fed.advanceStep();

		expect(await starving.screen()).toContain(`${first} starved.`);
		expect(await fed.screen()).not.toContain("starved");
	});

	test("the Archive notice appears once when coin first appears, and not after a restart", async () => {
		const harness = await launch();
		harness.state.posting.resources.coin = 5;

		const { announced, later } = await announcedThenLater(harness);
		await harness.app.shutdown();
		const startup = prepareStartup(harness.saveDir, tuning, () => NEW_SEED);
		if (startup.kind !== "ready") throw new Error("save not loaded");
		const restarted = await launch({
			saveDir: harness.saveDir,
			state: startup.state,
		});
		await restarted.advanceStep();

		expect(announced).toContain(ARCHIVE_OPENS);
		expect(later).not.toContain(ARCHIVE_OPENS);
		expect(await restarted.screen()).not.toContain(ARCHIVE_OPENS);
	});

	test("a purchase is announced once", async () => {
		const harness = await launch({ state: owning(ARCHIVE_PANEL) });
		const palette = tuning.archive.entries.find((e) => e.id === PALETTE_UNLOCK);
		harness.state.posting.resources.coin = (palette?.cost ?? 0) + 1;

		await harness.mockInput.typeText("apalette");
		harness.mockInput.pressEnter();
		const { announced, later } = await announcedThenLater(harness);

		expect(announced).toContain(`Bought ${palette?.label}.`);
		expect(later).not.toContain("Bought");
	});
});
