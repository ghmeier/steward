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
import { createNewGame, type GameState } from "../src/core/state";
import { stateHash } from "../src/save/hash";
import { readSaveFile, SAVE_FILE_NAME, saveGame } from "../src/save/save";
import { type App, prepareStartup, startApp } from "../src/tui/app";
import { tuning } from "./helpers";

const NEVER_MS = 1e9;
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
	options: { saveDir?: string; notice?: string | null } = {},
) {
	const saveDir = options.saveDir ?? tempDir();
	const setup = await createTestRenderer({
		width: 120,
		height: 30,
		exitOnCtrlC: false,
	});
	const state: GameState = createNewGame(5, tuning);
	let nowMs = 0;
	const app = startApp({
		renderer: setup.renderer,
		state,
		tuning,
		saveDir,
		now: () => nowMs,
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
		const harness = await launch();

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
