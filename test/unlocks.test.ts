import { describe, expect, test } from "bun:test";
import { apply, parseCommand } from "../src/core/commands";
import type { Condition } from "../src/core/decree";
import { enactDecree } from "../src/core/decree-engine";
import { createNewGame, type GameState } from "../src/core/state";
import { step } from "../src/core/step";
import { parseTuning } from "../src/core/tuning";
import {
	ARCHIVE_PANEL,
	buyUnlock,
	CHAINING_UNLOCK,
	COMPOUND_UNLOCK,
	hasUnlock,
	missingDecreeUnlock,
	runUnlocks,
} from "../src/core/unlocks";
import { validateState } from "../src/core/validate";
import { computeView } from "../src/core/view";
import { loadTuning } from "../src/save/content";
import { stateHash } from "../src/save/hash";
import {
	contextFor,
	fullTuningJson,
	grantUnlocks,
	quietOptions,
	tuning,
} from "./helpers";

const entry = (id: string) => {
	const found = tuning.archive.entries.find((candidate) => candidate.id === id);
	if (found === undefined) throw new Error(`no archive entry ${id}`);
	return found;
};
const palette = entry("control.palette");
const savedDecrees = entry("control.savedDecrees");

function richVillage(coin = 10_000): GameState {
	const state = createNewGame(1, tuning);
	state.tick = 7;
	state.posting.resources.coin = coin;
	grantUnlocks(state, [ARCHIVE_PANEL]);
	return state;
}

function buy(state: GameState, id: string) {
	return buyUnlock(state, id, tuning, contextFor(state));
}

function expectRejected(state: GameState, id: string, reasonPart: string) {
	const before = stateHash(state);

	const result = buy(state, id);

	expect(result.ok).toBe(false);
	expect(result.ok ? "" : result.reason).toContain(reasonPart);
	expect(stateHash(state)).toBe(before);
}

describe("buyUnlock", () => {
	test("spends exactly the entry's cost and records the current tick", () => {
		const state = richVillage(1000);

		const result = buy(state, palette.id);

		expect(result).toEqual({ ok: true });
		expect(state.posting.resources.coin).toBe(1000 - palette.cost);
		expect(state.career.unlocks[palette.id]).toBe(state.tick);
	});

	test("accepts a purchase when coin equals the cost exactly", () => {
		const state = richVillage(palette.cost);

		const result = buy(state, palette.id);

		expect(result).toEqual({ ok: true });
		expect(state.posting.resources.coin).toBe(0);
	});

	test("rejects with state unchanged when coin is below the cost", () => {
		expectRejected(richVillage(palette.cost - 1), palette.id, "costs");
	});

	test("rejects an unknown id", () => {
		expectRejected(richVillage(), "control.nothing", "does not sell");
	});

	test("rejects an entry that is already owned", () => {
		const state = richVillage();
		buy(state, palette.id);

		expectRejected(state, palette.id, "already owned");
	});

	test("rejects a play unlock id even when the village is rich", () => {
		const state = richVillage();
		delete state.career.unlocks[ARCHIVE_PANEL];

		expectRejected(state, ARCHIVE_PANEL, "only earned");
	});

	test("rejects an entry whose prerequisite is missing, then accepts it once owned", () => {
		const state = richVillage();
		expectRejected(state, savedDecrees.id, palette.label);

		buy(state, palette.id);
		const result = buy(state, savedDecrees.id);

		expect(result).toEqual({ ok: true });
	});

	test("rejects while the Archive is closed, then accepts once it opens", () => {
		const state = richVillage();
		delete state.career.unlocks[ARCHIVE_PANEL];
		expectRejected(state, palette.id, "the Archive is not open");

		grantUnlocks(state, [ARCHIVE_PANEL]);
		const result = buy(state, palette.id);

		expect(result).toEqual({ ok: true });
	});

	test("is reachable as a command and parses from a log entry", () => {
		const state = richVillage();
		const command = parseCommand({ type: "buyUnlock", id: palette.id });

		const result = apply(state, command, tuning, contextFor(state));

		expect(result).toEqual({ ok: true });
		expect(hasUnlock(state, palette.id)).toBe(true);
		expect(() => parseCommand({ type: "buyUnlock", id: 3 })).toThrow("id");
	});
});

const anyCondition: Condition = {
	kind: "any",
	conditions: [
		{ kind: "season", season: "winter" },
		{ kind: "compare", quantity: "coin", comparison: "above", value: 5 },
	],
};

function decreeWith(when: Condition) {
	return {
		id: "granary",
		petition: "harvest",
		rules: [{ when, policy: "feed" }],
		otherwise: "stockpile",
	};
}

describe("decree gating", () => {
	const compounds: [string, Condition][] = [
		["any", anyCondition],
		["all", { kind: "all", conditions: anyCondition.conditions }],
		["not", { kind: "not", condition: { kind: "season", season: "winter" } }],
	];

	for (const [name, condition] of compounds) {
		test(`a decree using ${name} is rejected on a fresh game and accepted once compound conditions are owned`, () => {
			const state = createNewGame(1, tuning);
			const rejected = enactDecree(state, decreeWith(condition), tuning);
			grantUnlocks(state, ["decree.compound"]);
			const accepted = enactDecree(state, decreeWith(condition), tuning);

			expect(rejected.ok).toBe(false);
			expect(rejected.ok ? "" : rejected.reason).toContain(
				entry("decree.compound").label,
			);
			expect(accepted).toEqual({ ok: true });
		});
	}

	test("a rejected compound decree leaves the state unchanged", () => {
		const state = createNewGame(1, tuning);
		const before = stateHash(state);

		enactDecree(state, decreeWith(anyCondition), tuning);

		expect(stateHash(state)).toBe(before);
	});

	test("a chose nested inside a compound condition is still gated by chaining", () => {
		const state = createNewGame(1, tuning);
		grantUnlocks(state, ["decree.compound"]);
		const nested: Condition = {
			kind: "all",
			conditions: [{ kind: "chose", decree: "base", policy: "feed" }],
		};

		const result = enactDecree(
			state,
			{ ...decreeWith(nested), petition: "labor", otherwise: "balanced" },
			tuning,
		);

		expect(result.ok).toBe(false);
		expect(result.ok ? "" : result.reason).toContain(
			entry("decree.chaining").label,
		);
	});

	test("chose is rejected on a fresh game and accepted once chaining is owned", () => {
		const state = createNewGame(1, tuning);
		enactDecree(
			state,
			{ ...decreeWith({ kind: "season", season: "winter" }), id: "base" },
			tuning,
		);
		const chained = {
			id: "follower",
			petition: "labor",
			rules: [
				{
					when: { kind: "chose", decree: "base", policy: "feed" },
					policy: "farm",
				},
			],
			otherwise: "balanced",
		};

		const rejected = enactDecree(state, chained, tuning);
		grantUnlocks(state, ["decree.chaining"]);
		const accepted = enactDecree(state, chained, tuning);

		expect(rejected.ok).toBe(false);
		expect(rejected.ok ? "" : rejected.reason).toContain(
			entry("decree.chaining").label,
		);
		expect(accepted).toEqual({ ok: true });
	});

	test("a decree using both names compound first and then chaining once compound is owned", () => {
		const state = createNewGame(1, tuning);
		const both: Condition = {
			kind: "all",
			conditions: [{ kind: "chose", decree: "base", policy: "feed" }],
		};
		const decree = {
			id: "x",
			petition: "labor" as const,
			rules: [{ when: both, policy: "farm" }],
			otherwise: "balanced",
		};

		const first = missingDecreeUnlock(state, decree, tuning)?.id;
		grantUnlocks(state, ["decree.compound"]);
		const second = missingDecreeUnlock(state, decree, tuning)?.id;

		expect(first).toBe("decree.compound");
		expect(second).toBe("decree.chaining");
	});

	test("missingDecreeUnlock returns null for compare and season decrees", () => {
		const state = createNewGame(1, tuning);
		const plain = decreeWith({ kind: "season", season: "winter" });
		const compare = decreeWith({
			kind: "compare",
			quantity: "grain",
			comparison: "above",
			value: 1,
		});

		for (const value of [plain, compare]) {
			const decree = {
				...value,
				petition: "harvest" as const,
			};
			expect(missingDecreeUnlock(state, decree, tuning)).toBeNull();
		}
	});
});

describe("play unlocks and need hooks", () => {
	function stateWithCoin(coin: number): GameState {
		const state = createNewGame(1, tuning);
		state.posting.resources.coin = coin;
		return state;
	}

	test("a play unlock records the first tick its condition held and never changes it", () => {
		const state = stateWithCoin(0);
		state.tick = 3;
		runUnlocks(state, tuning);
		expect(hasUnlock(state, ARCHIVE_PANEL)).toBe(false);

		state.tick = 4;
		state.posting.resources.coin = 5;
		runUnlocks(state, tuning);
		state.tick = 5;
		state.posting.resources.coin = 0;
		runUnlocks(state, tuning);
		state.tick = 6;
		state.posting.resources.coin = 9;
		runUnlocks(state, tuning);

		expect(state.career.unlocks[ARCHIVE_PANEL]).toBe(4);
	});

	test("a need hook records the first tick its condition held and never changes it", () => {
		const state = stateWithCoin(0);
		state.tick = 3;
		runUnlocks(state, tuning);
		expect(state.career.needed).toEqual({});

		state.tick = 4;
		state.posting.resources.coin = 5;
		runUnlocks(state, tuning);
		state.tick = 5;
		state.posting.resources.coin = 0;
		runUnlocks(state, tuning);
		state.tick = 6;
		state.posting.resources.coin = 9;
		runUnlocks(state, tuning);

		expect(state.career.needed.archive).toBe(4);
	});

	test("step runs unlocks, so the Archive opens on the step coin first exists", () => {
		const state = stateWithCoin(5);

		step(state, [], tuning, quietOptions);

		expect(state.career.unlocks[ARCHIVE_PANEL]).toBe(state.tick);
	});
});

describe("view", () => {
	test("a fresh game holds no unlocks, the Archive is closed and the crown is locked", () => {
		const state = createNewGame(1, tuning);

		const view = computeView(state, tuning);

		expect(state.career.unlocks).toEqual({});
		expect(view.unlocks).toEqual([]);
		expect(view.archive.open).toBe(false);
		expect(view.lockedPanels).toEqual(["crown"]);
	});

	test("the crown unlocks once panel.crown is owned", () => {
		const state = createNewGame(1, tuning);
		grantUnlocks(state, ["panel.crown"]);

		expect(computeView(state, tuning).lockedPanels).toEqual([]);
	});

	test("archive entries follow data order with ownership, affordability and availability", () => {
		const state = richVillage(palette.cost);
		buy(state, palette.id);
		state.posting.resources.coin = savedDecrees.cost;

		const view = computeView(state, tuning);

		expect(view.archive.open).toBe(true);
		expect(view.archive.entries.map((e) => e.id)).toEqual(
			tuning.archive.entries.map((e) => e.id),
		);
		expect(view.archive.entries[0]).toMatchObject({
			owned: true,
			available: true,
		});
		expect(view.archive.entries[1]).toMatchObject({
			owned: false,
			available: true,
			affordable: true,
		});
		expect(view.archive.entries[3]).toMatchObject({ affordable: false });
		expect(view.unlocks).toEqual([ARCHIVE_PANEL, palette.id].sort());
	});

	test("an entry is unavailable while a prerequisite is unowned", () => {
		const state = richVillage();

		const view = computeView(state, tuning);

		expect(
			view.archive.entries.find((e) => e.id === savedDecrees.id)?.available,
		).toBe(false);
	});
});

describe("career validation", () => {
	test("rejects a malformed saved decree and a malformed needed record", () => {
		const state = createNewGame(1, tuning);
		(state.career.savedDecrees as Record<string, unknown>).bad = { id: "bad" };
		(state.career.needed as Record<string, unknown>).court = -1;

		const text = validateState(state).join("\n");

		expect(text).toContain("$.career.savedDecrees.bad");
		expect(text).toContain("$.career.needed.court");
	});

	test("accepts a well-formed saved decree", () => {
		const state = createNewGame(1, tuning);
		state.career.savedDecrees.keep = {
			id: "keep",
			petition: "harvest",
			rules: [],
			otherwise: "stockpile",
		};

		expect(validateState(state)).toEqual([]);
	});
});

describe("archive tuning", () => {
	test("the shipped data directory loads with the four entries", () => {
		const loaded = loadTuning();

		expect(loaded.archive.entries.map((e) => e.id)).toEqual([
			"control.palette",
			"control.savedDecrees",
			"decree.compound",
			"decree.chaining",
		]);
		expect(loaded.archive.maxSaved).toBeGreaterThan(0);
	});

	function parseWith(change: (archive: ArchiveJson) => void): unknown {
		const archive = structuredClone(fullTuningJson.archive) as ArchiveJson;
		change(archive);
		return parseTuning({ ...fullTuningJson, archive });
	}

	// biome-ignore lint/suspicious/noExplicitAny: test mutates arbitrary JSON paths
	type ArchiveJson = Record<string, any>;

	const bad: [string, (archive: ArchiveJson) => void, string][] = [
		[
			"a duplicate id across entries",
			(a) => {
				a.entries[1].id = a.entries[0].id;
			},
			"repeats id",
		],
		[
			"a play id that repeats an entry id",
			(a) => {
				a.play.push({ ...a.play[0], id: a.entries[0].id });
			},
			"repeats id",
		],
		[
			"a requires naming an unknown id",
			(a) => {
				a.entries[0].requires = ["control.nothing"];
			},
			"unknown id",
		],
		[
			"a requires cycle",
			(a) => {
				a.entries[0].requires = ["control.savedDecrees"];
			},
			"cycle",
		],
		[
			"a zero cost",
			(a) => {
				a.entries[0].cost = 0;
			},
			"cost must be positive",
		],
		[
			"a play condition that is compound",
			(a) => {
				a.play[0].when = { kind: "all", conditions: [a.play[0].when] };
			},
			"compare or season",
		],
		[
			"a need hook condition that chooses",
			(a) => {
				a.needs[0].when = { kind: "chose", decree: "x", policy: "feed" };
			},
			"compare or season",
		],
		[
			"a zero maxSaved",
			(a) => {
				a.maxSaved = 0;
			},
			"maxSaved",
		],
		[
			"a fractional maxSaved",
			(a) => {
				a.maxSaved = 1.5;
			},
			"maxSaved",
		],
		[
			"a repeated need hook control",
			(a) => {
				a.needs[1].control = a.needs[0].control;
			},
			"repeats control",
		],
		[
			"no compound conditions entry",
			(a) => {
				a.entries = a.entries.filter(
					(entry: { id: string }) => entry.id !== COMPOUND_UNLOCK,
				);
			},
			COMPOUND_UNLOCK,
		],
		[
			"no chaining entry",
			(a) => {
				a.entries = a.entries.filter(
					(entry: { id: string }) => entry.id !== CHAINING_UNLOCK,
				);
			},
			CHAINING_UNLOCK,
		],
		[
			"no Archive panel play unlock",
			(a) => {
				a.play = [];
			},
			ARCHIVE_PANEL,
		],
	];

	for (const [name, change, fragment] of bad) {
		test(`rejects ${name}`, () => {
			expect(() => parseWith(change)).toThrow(fragment);
		});
	}
});
