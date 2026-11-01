import { afterEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestRenderer } from "@opentui/core/testing";
import { bearPeasant } from "../src/core/delegates";
import { createNewGame, type GameState } from "../src/core/state";
import { ARCHIVE_PANEL, PALETTE_UNLOCK } from "../src/core/unlocks";
import { stateHash } from "../src/save/hash";
import { readSaveFile, SAVE_FILE_NAME, saveGame } from "../src/save/save";
import { type App, prepareStartup, startApp } from "../src/tui/app";
import { hintsText } from "../src/tui/keys";
import { ARCHIVE_OPENS } from "../src/tui/unlock-notices";
import { grantUnlocks, setFamineDue, setRoster, tuning } from "./helpers";

const allUnlocks = [
	ARCHIVE_PANEL,
	...tuning.archive.entries.map((entry) => entry.id),
];
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
		mockInput: setup.mockInput,
		renders: () => renders,
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
	test("a missing save starts a new game from the injected seed with a notice", () => {
		const startup = prepareStartup(tempDir(), tuning, () => 42);

		expect(startup).toEqual({
			kind: "ready",
			state: createNewGame(42, tuning),
			notice: expect.any(String),
		});
	});

	test("a saved game loads with the same state hash and no notice", () => {
		const dir = tempDir();
		const saved = createNewGame(9, tuning);
		saved.tick = 12;
		saveGame(dir, saved);

		const startup = prepareStartup(dir, tuning, () => 1);

		expect(startup.kind).toBe("ready");
		if (startup.kind !== "ready") return;
		expect(stateHash(startup.state)).toBe(stateHash(saved));
		expect(startup.notice).toBeNull();
	});

	test("a save of an unsupported version starts a new game and names the preserved file", () => {
		const dir = tempDir();
		const old = { ...createNewGame(3, tuning), schemaVersion: 0 };
		writeFileSync(
			join(dir, SAVE_FILE_NAME),
			JSON.stringify({
				schemaVersion: 0,
				savedAt: "",
				contentHash: "",
				state: old,
			}),
		);

		const startup = prepareStartup(dir, tuning, () => 42);

		expect(startup.kind).toBe("ready");
		if (startup.kind !== "ready") return;
		const preservedPath = join(dir, "save.v0.json");
		expect(existsSync(preservedPath)).toBe(true);
		expect(startup.notice).toContain(preservedPath);
		expect(stateHash(startup.state)).toBe(stateHash(createNewGame(42, tuning)));
	});

	test("an invalid save is refused and left byte for byte unchanged", () => {
		const dir = tempDir();
		const path = join(dir, SAVE_FILE_NAME);
		writeFileSync(path, "{ not json");

		const startup = prepareStartup(dir, tuning, () => 1);

		expect(startup.kind).toBe("refused");
		expect(readFileSync(path, "utf8")).toBe("{ not json");
	});
});

describe("startApp", () => {
	test("the first frame shows every panel title and the startup notice", async () => {
		const harness = await launch({ notice: "Started a new game." });

		const screen = await harness.screen();

		for (const title of ["Ledger", "Crown", "Desk", "Peasants"]) {
			expect(screen).toContain(title);
		}
		expect(screen).toContain("Started a new game.");
	});

	test("pressing f puts the selected peasant on the farm, shown after the next step", async () => {
		const harness = await launch();
		const idle = tuning.economy.initialPopulation;

		harness.mockInput.pressKey("f");
		await harness.advanceStep();

		const screen = await harness.screen();
		expect(screen).toContain(`Population  ${idle} (${idle - 1} idle)`);
		expect(screen).toContain("Farm 1  Forest 0  Mine 0");
	});

	test("j moves the cursor so the next assignment goes to the second peasant", async () => {
		const harness = await launch({ state: villageOf(3) });

		harness.mockInput.pressKey("j");
		harness.mockInput.pressKey("m");
		await harness.advanceStep();

		const [first, second] = harness.state.posting.delegates;
		expect(first?.job).toBe("idle");
		expect(second?.job).toBe("mine");
		expect(await harness.screen()).toMatch(
			new RegExp(`> ${second?.name} {2}mine`),
		);
	});

	test("assigning the selected peasant to the job they already hold shows the rejection reason in the footer", async () => {
		const harness = await launch();

		harness.mockInput.pressKey("f");
		harness.mockInput.pressKey("f");
		await harness.advanceStep();

		const name = harness.state.posting.delegates[0]?.name;
		expect(await harness.screen()).toContain(`${name} already works the farm`);
	});

	test("pressing s saves the live state and says so", async () => {
		const harness = await launch();
		harness.mockInput.pressKey("f");
		await harness.advanceStep();

		harness.mockInput.pressKey("s");

		expect(savedHash(harness.saveDir)).toBe(stateHash(harness.state));
		expect(await harness.screen()).toContain("Saved.");
	});

	for (const [name, press] of [
		[
			"q",
			(input: { pressKey: (k: string, o?: { ctrl: boolean }) => void }) =>
				input.pressKey("q"),
		],
		[
			"Ctrl-C",
			(input: { pressKey: (k: string, o?: { ctrl: boolean }) => void }) =>
				input.pressKey("c", { ctrl: true }),
		],
	] as const) {
		test(`pressing ${name} saves the current state and finishes the app`, async () => {
			const harness = await launch();
			harness.mockInput.pressKey("f");
			await harness.advanceStep();

			press(harness.mockInput);
			const exit = await harness.app.done;

			expect(exit.saveError).toBeNull();
			expect(savedHash(harness.saveDir)).toBe(stateHash(harness.state));
			expect(harness.savedWhenDestroyed()).toBe(stateHash(harness.state));
		});
	}

	test("hangUp saves the live state without touching the renderer", async () => {
		const harness = await launch();
		harness.mockInput.pressKey("f");
		await harness.advanceStep();

		const exit = harness.app.hangUp();

		expect(exit.saveError).toBeNull();
		expect(savedHash(harness.saveDir)).toBe(stateHash(harness.state));
		expect(harness.destroyCalls()).toBe(0);
	});

	test("a frame after hangUp neither steps nor renders", async () => {
		const harness = await launch();
		harness.app.hangUp();
		const rendersBefore = harness.renders();
		const tickBefore = harness.state.tick;

		await harness.advanceStep();

		expect(harness.renders()).toBe(rendersBefore);
		expect(harness.state.tick).toBe(tickBefore);
	});

	test("hangUp after a completed shutdown does not save a second time", async () => {
		const harness = await launch();
		saveGame(harness.saveDir, createNewGame(77, tuning));
		await harness.app.shutdown();

		const exit = harness.app.hangUp();

		expect(exit.saveError).toBeNull();
		expect(
			stateHash(
				readSaveFile(join(harness.saveDir, `${SAVE_FILE_NAME}.bak`)).state,
			),
		).toBe(stateHash(createNewGame(77, tuning)));
	});

	test("hangUp reports the save error when the save directory is unwritable", async () => {
		const blocker = join(tempDir(), "not-a-directory");
		writeFileSync(blocker, "");
		const harness = await launch({ saveDir: blocker });

		const exit = harness.app.hangUp();

		expect(exit.saveError).not.toBeNull();
	});

	test("calling shutdown twice returns the same promise and saves once", async () => {
		const harness = await launch();
		saveGame(harness.saveDir, createNewGame(77, tuning));

		const first = harness.app.shutdown();
		const second = harness.app.shutdown();
		await first;

		expect(second).toBe(first);
		expect(
			stateHash(
				readSaveFile(join(harness.saveDir, `${SAVE_FILE_NAME}.bak`)).state,
			),
		).toBe(stateHash(createNewGame(77, tuning)));
	});

	test("a failing save shows in the footer, keeps the app running and is reported at shutdown", async () => {
		const parent = tempDir();
		const blocker = join(parent, "not-a-directory");
		writeFileSync(blocker, "");
		const harness = await launch({ saveDir: blocker });

		harness.mockInput.pressKey("s");
		await harness.advanceStep();
		const screen = await harness.screen();
		const exit = await harness.app.shutdown();

		expect(screen).toContain("Save failed");
		expect(exit.saveError).not.toBeNull();
	});

	test("a frame that runs no step does not request a render", async () => {
		const harness = await launch();
		const before = harness.renders();

		harness.app.frame();

		expect(harness.renders()).toBe(before);
	});

	test("a frame that runs a step with a changed view requests a render", async () => {
		const harness = await launch();
		const before = harness.renders();

		await harness.advanceStep();

		expect(harness.renders()).toBeGreaterThan(before);
	});
});

describe("command line in the app", () => {
	test("d opens the command line with decree typed, in place of the panel grid", async () => {
		const harness = await launch();

		harness.mockInput.pressKey("d");

		const screen = await harness.screen();
		expect(screen).toContain("Command");
		expect(screen).toContain(": decree _");
		expect(screen).not.toContain("Ledger");
	});

	test("typed characters reach the line", async () => {
		const harness = await launch();
		harness.mockInput.pressKey("d");

		await harness.mockInput.typeText("wood");

		expect(await harness.screen()).toContain(": decree wood_");
	});

	test("the line lists the decrees in force", async () => {
		const state = createNewGame(5, tuning);
		state.posting.decrees.wood = {
			id: "wood",
			petition: "wood",
			rules: [],
			otherwise: "sell",
		};
		const harness = await launch({ state });

		harness.mockInput.pressKey("d");

		expect(await harness.screen()).toContain("wood (wood): otherwise sell");
	});

	test("a space typed under the kitty keyboard protocol reaches the line", async () => {
		const harness = await launch({ kittyKeyboard: true });
		harness.mockInput.pressKey("d");

		await harness.mockInput.typeText("wood ");

		expect(await harness.screen()).toContain(": decree wood _");
	});

	test("game keys do not assign while the line is open", async () => {
		const harness = await launch();
		harness.mockInput.pressKey("d");

		harness.mockInput.pressKey("f");
		await harness.advanceStep();

		expect(harness.state.posting.delegates.every((p) => p.job === "idle")).toBe(
			true,
		);
	});

	test("escape closes the line and brings the panels back", async () => {
		const harness = await launch({ kittyKeyboard: true });
		harness.mockInput.pressKey("d");

		harness.mockInput.pressEscape();

		expect(await harness.screen()).toContain("Ledger");
	});

	test("a decree typed on the line reaches the game state through the session", async () => {
		const harness = await launch();
		harness.mockInput.pressKey("d");

		await harness.mockInput.typeText(
			"wood sell when coin above 5 otherwise stockpile",
		);
		harness.mockInput.pressEnter();
		await harness.advanceStep();

		expect(Object.keys(harness.state.posting.decrees)).toEqual(["wood"]);
		expect(await harness.screen()).toContain("Ledger");
	});

	test("ctrl-c still quits with the line open", async () => {
		const harness = await launch();
		harness.mockInput.pressKey("d");

		harness.mockInput.pressCtrlC();
		await harness.app.done;

		expect(harness.destroyCalls()).toBe(1);
	});
});

function villageOf(peasants: number): GameState {
	const state = createNewGame(5, tuning);
	setRoster(state, { idle: peasants });
	return state;
}

function holdHenDispute(state: GameState): void {
	state.posting.desk.disputes = [
		{ id: 1, template: "stolen-hen", parties: [1, 2], arrivedAt: 0 },
	];
	state.posting.desk.nextDisputeId = 2;
}

describe("court menu in the app", () => {
	test("c opens the court menu listing the waiting dispute", async () => {
		const harness = await launch({ state: villageOf(2) });
		holdHenDispute(harness.state);
		await harness.advanceStep();

		harness.mockInput.pressKey("c");

		const screen = await harness.screen();
		expect(screen).toContain("Hold court");
		expect(screen).toContain("accuses");
		expect(screen).not.toContain("Ledger");
	});

	test("settling a dispute through the menu removes it from the game state", async () => {
		const harness = await launch({ state: villageOf(2) });
		holdHenDispute(harness.state);
		await harness.advanceStep();

		harness.mockInput.pressKey("c");
		harness.mockInput.pressEnter();
		harness.mockInput.pressKey("j");
		harness.mockInput.pressKey("j");
		harness.mockInput.pressEnter();
		await harness.advanceStep();

		expect(harness.state.posting.desk.disputes).toEqual([]);
		expect(await harness.screen()).toContain("No disputes wait on the desk.");
	});
});

describe("promotion notice in the app", () => {
	const notice = "The crown has noticed you. You are promoted to steward.";

	function nearlyPromoted(): GameState {
		const state = createNewGame(5, tuning);
		while (
			state.posting.delegates.length < tuning.village.promotionPopulation
		) {
			bearPeasant(state.posting, tuning.village.names);
		}
		return state;
	}

	test("promotion during the session is announced once", async () => {
		const harness = await launch({ state: nearlyPromoted() });

		await harness.advanceStep();
		const announced = await harness.screen();
		harness.mockInput.pressKey("s");
		await harness.advanceStep();
		await harness.advanceStep();
		const later = await harness.screen();

		expect(announced).toContain(notice);
		expect(later).not.toContain(notice);
	});

	test("a loaded save that was already promoted is not announced", async () => {
		const state = nearlyPromoted();
		state.tick = 5;
		state.career.promotedAt = 3;
		const harness = await launch({ state });

		await harness.advanceStep();

		expect(await harness.screen()).not.toContain(notice);
	});
});

describe("help menu in the app", () => {
	test("? opens the help menu in place of the panel grid", async () => {
		const harness = await launch();

		harness.mockInput.pressKey("?");

		const screen = await harness.screen();
		expect(screen).toContain("Grain and growth");
		expect(screen).not.toContain("Ledger");
	});

	test("escape backs out of a topic and then out of the menu", async () => {
		const harness = await launch({ kittyKeyboard: true });
		harness.mockInput.pressKey("?");
		harness.mockInput.pressEnter();
		expect(await harness.screen()).toContain("Back");

		harness.mockInput.pressEscape();
		expect(await harness.screen()).toContain("Grain and growth");

		harness.mockInput.pressEscape();
		expect(await harness.screen()).toContain("Ledger");
	});

	test("game keys do nothing while help is open", async () => {
		const harness = await launch();
		harness.mockInput.pressKey("?");

		harness.mockInput.pressKey("f");
		harness.mockInput.pressKey("c");
		await harness.advanceStep();

		expect(harness.state.posting.delegates.every((p) => p.job === "idle")).toBe(
			true,
		);
		expect(await harness.screen()).toContain("Keys");
	});

	test("the hints line fits the footer width", () => {
		expect(hintsText(allUnlocks).length).toBeLessThanOrEqual(120);
	});
});

describe("starvation notice in the app", () => {
	function starvingNextStep(): GameState {
		const state = createNewGame(5, tuning);
		state.posting.resources.grain = 0;
		setFamineDue(state, 1, tuning.economy.ticksPerSeason);
		return state;
	}

	test("a peasant starving during the session is named in the footer", async () => {
		const state = starvingNextStep();
		const first = state.posting.delegates[0]?.name as string;
		const harness = await launch({ state });

		await harness.advanceStep();

		expect(state.posting.economy.starved).toBe(1);
		expect(await harness.screen()).toContain(`${first} starved.`);
	});

	test("a fed village shows no starvation notice", async () => {
		const harness = await launch();

		await harness.advanceStep();

		expect(await harness.screen()).not.toContain("starved");
	});
});

describe("new village in the app", () => {
	function openNewVillageMenu(harness: Awaited<ReturnType<typeof launch>>) {
		harness.mockInput.pressKey("n");
	}

	test("n opens a confirmation in place of the panel grid", async () => {
		const harness = await launch();

		openNewVillageMenu(harness);

		const screen = await harness.screen();
		expect(screen).toContain("Found a new village?");
		expect(screen).not.toContain("Ledger");
	});

	test("the confirmation warns about Archive purchases only once the player owns any", async () => {
		const owner = createNewGame(5, tuning);
		grantUnlocks(owner, [ARCHIVE_PANEL]);
		const withUnlocks = await launch({ state: owner });
		const fresh = await launch();

		openNewVillageMenu(withUnlocks);
		openNewVillageMenu(fresh);

		expect(await withUnlocks.screen()).toContain("bought in the Archive");
		expect(await fresh.screen()).not.toContain("Archive");
	});

	test("choosing yes founds a new game, and saves it at once", async () => {
		const harness = await launch();
		harness.mockInput.pressKey("f");
		await harness.advanceStep();
		saveGame(harness.saveDir, harness.state);

		openNewVillageMenu(harness);
		harness.mockInput.pressKey("j");
		harness.mockInput.pressEnter();

		const saved = readSaveFile(join(harness.saveDir, SAVE_FILE_NAME)).state;
		expect(stateHash(saved)).toBe(stateHash(createNewGame(NEW_SEED, tuning)));
		expect(saved.tick).toBe(0);
		expect(saved.posting.delegates).toHaveLength(
			tuning.economy.initialPopulation,
		);
		expect(
			stateHash(
				readSaveFile(join(harness.saveDir, `${SAVE_FILE_NAME}.bak`)).state,
			),
		).toBe(stateHash(harness.state));
		const screen = await harness.screen();
		expect(screen).toContain("A new village is founded.");
		expect(screen).toContain("Ledger");
	});

	test("the new village runs on its own state and the first peasant is selected again", async () => {
		const harness = await launch();
		harness.mockInput.pressKey("j");
		harness.mockInput.pressKey("j");
		openNewVillageMenu(harness);
		harness.mockInput.pressKey("j");
		harness.mockInput.pressEnter();

		harness.mockInput.pressKey("f");
		await harness.advanceStep();
		await harness.advanceStep();
		harness.mockInput.pressKey("s");

		const saved = readSaveFile(join(harness.saveDir, SAVE_FILE_NAME)).state;
		expect(saved.tick).toBeGreaterThan(0);
		expect(saved.posting.delegates[0]?.job).toBe("farm");
		expect(harness.state.tick).toBe(0);
	});

	test("choosing no leaves the game and the save untouched", async () => {
		const harness = await launch();
		const before = stateHash(harness.state);

		openNewVillageMenu(harness);
		harness.mockInput.pressEnter();

		expect(stateHash(harness.state)).toBe(before);
		expect(existsSync(join(harness.saveDir, SAVE_FILE_NAME))).toBe(false);
		expect(await harness.screen()).toContain("Ledger");
	});

	test("escape closes the confirmation without founding a village", async () => {
		const harness = await launch({ kittyKeyboard: true });
		const before = stateHash(harness.state);

		openNewVillageMenu(harness);
		harness.mockInput.pressEscape();

		expect(stateHash(harness.state)).toBe(before);
		expect(existsSync(join(harness.saveDir, SAVE_FILE_NAME))).toBe(false);
		expect(await harness.screen()).toContain("Ledger");
	});
});

describe("palette and Archive doors in the app", () => {
	test("a and : do nothing on a fresh game", async () => {
		const harness = await launch();

		harness.mockInput.pressKey("a");
		harness.mockInput.pressKey(":");

		const screen = await harness.screen();
		expect(screen).not.toContain("Command");
		expect(screen).toContain("Ledger");
	});

	test("a opens the line with buy typed once the Archive panel is owned", async () => {
		const state = createNewGame(5, tuning);
		grantUnlocks(state, [ARCHIVE_PANEL]);
		const harness = await launch({ state });

		harness.mockInput.pressKey("a");

		expect(await harness.screen()).toContain(": buy _");
	});

	test("the colon key opens the empty line once the palette is owned", async () => {
		const state = createNewGame(5, tuning);
		grantUnlocks(state, [PALETTE_UNLOCK]);
		const harness = await launch({ state });

		harness.mockInput.pressKey(":");

		expect(await harness.screen()).toContain(": _");
	});

	test("the Archive notice appears once when coin first appears in a running app", async () => {
		const harness = await launch();
		harness.state.posting.resources.coin = 5;

		await harness.advanceStep();
		const announced = await harness.screen();
		harness.mockInput.pressKey("s");
		await harness.advanceStep();
		const later = await harness.screen();

		expect(announced).toContain(ARCHIVE_OPENS);
		expect(later).not.toContain(ARCHIVE_OPENS);
	});

	test("restarting from a save that already owns the Archive does not announce it", async () => {
		const first = await launch();
		first.state.posting.resources.coin = 5;
		await first.advanceStep();
		await first.app.shutdown();
		const startup = prepareStartup(first.saveDir, tuning, () => NEW_SEED);
		if (startup.kind !== "ready") throw new Error("save not loaded");

		const second = await launch({
			saveDir: first.saveDir,
			state: startup.state,
		});
		await second.advanceStep();

		expect(await second.screen()).not.toContain(ARCHIVE_OPENS);
	});

	test("the palette opens from a colon and from shift-semicolon under the kitty protocol", async () => {
		const state = createNewGame(5, tuning);
		grantUnlocks(state, [PALETTE_UNLOCK]);
		const harness = await launch({ state, kittyKeyboard: true });

		harness.mockInput.pressKey(":");
		const plain = await harness.screen();
		harness.mockInput.pressEscape();
		harness.mockInput.pressKey(";", { shift: true });
		const shifted = await harness.screen();

		expect(plain).toContain(": _");
		expect(shifted).toContain(": _");
	});

	test("a purchase is announced once", async () => {
		const state = createNewGame(5, tuning);
		grantUnlocks(state, [ARCHIVE_PANEL]);
		const harness = await launch({ state });
		const palette = tuning.archive.entries.find(
			(entry) => entry.id === PALETTE_UNLOCK,
		);
		harness.state.posting.resources.coin = (palette?.cost ?? 0) + 1;

		harness.mockInput.pressKey("a");
		await harness.mockInput.typeText("palette");
		harness.mockInput.pressEnter();
		await harness.advanceStep();
		const announced = await harness.screen();
		harness.mockInput.pressKey("s");
		await harness.advanceStep();
		const later = await harness.screen();

		expect(announced).toContain(`Bought ${palette?.label}.`);
		expect(later).not.toContain("Bought");
	});
});
