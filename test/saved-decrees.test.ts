import { describe, expect, test } from "bun:test";
import { apply, type CommandResult, parseCommand } from "../src/core/commands";
import type { Condition } from "../src/core/decree";
import { enactDecree, repealDecree } from "../src/core/decree-engine";
import { enactSaved, forgetSaved, saveDecree } from "../src/core/saved-decrees";
import { createNewGame, type GameState } from "../src/core/state";
import {
	CHAINING_UNLOCK,
	COMPOUND_UNLOCK,
	SAVED_DECREES_UNLOCK,
} from "../src/core/unlocks";
import { computeView } from "../src/core/view";
import { stateHash } from "../src/save/hash";
import { parseSave, serializeSave } from "../src/save/save";
import { contextFor, grantUnlocks, tuning } from "./helpers";

function labelOf(id: string): string {
	const found = tuning.archive.entries.find((entry) => entry.id === id);
	if (found === undefined) throw new Error(`no archive entry ${id}`);
	return found.label;
}
const SAVED = SAVED_DECREES_UNLOCK;
const savedLabel = labelOf(SAVED);

function village(unlocks: string[] = [SAVED]): GameState {
	const state = createNewGame(1, tuning);
	grantUnlocks(state, unlocks);
	return state;
}

function harvest(id: string, policy = "feed", otherwise = "stockpile") {
	return {
		id,
		petition: "harvest",
		rules: [{ when: { kind: "season", season: "winter" }, policy }],
		otherwise,
	};
}

function chainedLabor(target: string) {
	return {
		id: "x",
		petition: "labor",
		rules: [
			{
				when: { kind: "chose", decree: target, policy: "feed" },
				policy: "farm",
			},
		],
		otherwise: "balanced",
	};
}

const anyCondition: Condition = {
	kind: "any",
	conditions: [
		{ kind: "season", season: "winter" },
		{ kind: "season", season: "autumn" },
	],
};

function expectRejected(
	state: GameState,
	run: () => CommandResult,
	reasonPart: string,
) {
	const before = stateHash(state);

	const result = run();

	expect(result.ok).toBe(false);
	expect(result.ok ? "" : result.reason).toContain(reasonPart);
	expect(stateHash(state)).toBe(before);
}

describe("saveDecree", () => {
	test("is rejected without the Archive entry, naming it, and leaves the state unchanged", () => {
		const state = village([]);

		expectRejected(
			state,
			() => saveDecree(state, "plan", harvest("plan"), tuning),
			savedLabel,
		);
	});

	test("stores the decree under the name once the entry is owned", () => {
		const state = village();

		const result = saveDecree(state, "plan", harvest("ignored"), tuning);

		expect(result).toEqual({ ok: true });
		expect(state.career.savedDecrees.plan?.id).toBe("plan");
		expect(state.career.savedDecrees.plan?.rules).toHaveLength(1);
	});

	test("rejects a compound decree without compound conditions and accepts it with them", () => {
		const state = village();
		const compound = {
			...harvest("plan"),
			rules: [{ when: anyCondition, policy: "feed" }],
		};

		expectRejected(
			state,
			() => saveDecree(state, "plan", compound, tuning),
			labelOf(COMPOUND_UNLOCK),
		);
		grantUnlocks(state, [COMPOUND_UNLOCK]);
		const accepted = saveDecree(state, "plan", compound, tuning);

		expect(accepted).toEqual({ ok: true });
	});

	test("rejects an invalid name and a policy that does not fit the petition", () => {
		const state = village();

		expectRejected(
			state,
			() => saveDecree(state, "Bad Name", harvest("x"), tuning),
			"not a valid decree name",
		);
		expectRejected(
			state,
			() => saveDecree(state, "plan", harvest("plan", "farm"), tuning),
			"is not a harvest policy",
		);
	});

	test("rejects a new name at the cap and allows replacing an existing name there", () => {
		const state = village();
		const cap = tuning.archive.maxSaved;
		for (let index = 0; index < cap; index++) {
			saveDecree(
				state,
				`d${String.fromCharCode(97 + index)}`,
				harvest("x"),
				tuning,
			);
		}

		expectRejected(
			state,
			() => saveDecree(state, "extra", harvest("x"), tuning),
			String(cap),
		);
		const replaced = saveDecree(state, "da", harvest("x", "sell"), tuning);

		expect(replaced).toEqual({ ok: true });
		expect(Object.keys(state.career.savedDecrees)).toHaveLength(cap);
		expect(state.career.savedDecrees.da?.rules[0]?.policy).toBe("sell");
	});
});

describe("enactSaved", () => {
	test("replaces the active decree for the petition and keeps its id", () => {
		const state = village();
		enactDecree(state, harvest("granary"), tuning);
		saveDecree(state, "plan", harvest("x", "sell"), tuning);

		const result = enactSaved(state, "plan", tuning);

		expect(result).toEqual({ ok: true });
		expect(Object.keys(state.posting.decrees)).toEqual(["granary"]);
		expect(state.posting.decrees.granary?.rules[0]?.policy).toBe("sell");
	});

	test("uses the petition name when no decree is active for it", () => {
		const state = village();
		saveDecree(state, "plan", harvest("x"), tuning);

		const result = enactSaved(state, "plan", tuning);

		expect(result).toEqual({ ok: true });
		expect(Object.keys(state.posting.decrees)).toEqual(["harvest"]);
	});

	test("rejects a saved chain whose target is no longer in force with the enact reason", () => {
		const state = village([CHAINING_UNLOCK, SAVED]);
		enactDecree(state, harvest("base"), tuning);
		saveDecree(state, "follow", chainedLabor("base"), tuning);
		repealDecree(state, "base");
		const before = stateHash(state);
		const expected = enactDecree(
			structuredClone(state),
			{ ...chainedLabor("base"), id: "labor" },
			tuning,
		);

		const result = enactSaved(state, "follow", tuning);

		expect(expected.ok).toBe(false);
		expect(result).toEqual(expected);
		expect(result.ok ? "" : result.reason).toContain(
			'references unknown decree "base"',
		);
		expect(stateHash(state)).toBe(before);
	});

	test("is rejected without the entry and for an unknown name", () => {
		const locked = village([]);
		const state = village();

		expectRejected(
			locked,
			() => enactSaved(locked, "plan", tuning),
			savedLabel,
		);
		expectRejected(state, () => enactSaved(state, "plan", tuning), "plan");
	});
});

describe("forgetSaved", () => {
	test("removes the named decree and rejects an unknown name", () => {
		const state = village();
		saveDecree(state, "plan", harvest("x"), tuning);

		const removed = forgetSaved(state, "plan");

		expect(removed).toEqual({ ok: true });
		expect(state.career.savedDecrees).toEqual({});
		expectRejected(state, () => forgetSaved(state, "plan"), "plan");
	});

	test("still works when the Archive entry is not owned", () => {
		const state = village();
		saveDecree(state, "plan", harvest("x"), tuning);
		delete state.career.unlocks[SAVED];

		const result = forgetSaved(state, "plan");

		expect(result).toEqual({ ok: true });
		expect(state.career.savedDecrees).toEqual({});
	});
});

describe("saved decrees elsewhere in the core", () => {
	test("survive a save and load round trip", () => {
		const state = village();
		saveDecree(state, "plan", harvest("x"), tuning);
		const meta = { savedAt: "2026-01-01T00:00:00.000Z", contentHash: "abc" };

		const loaded = parseSave(serializeSave(state, meta)).state;

		expect(loaded.career.savedDecrees).toEqual(state.career.savedDecrees);
	});

	test("the view lists saved decrees sorted by name", () => {
		const state = village();
		for (const name of ["zeta", "alpha", "mid"]) {
			saveDecree(state, name, harvest("x"), tuning);
		}

		const view = computeView(state, tuning);

		expect(view.savedDecrees.map((decree) => decree.id)).toEqual([
			"alpha",
			"mid",
			"zeta",
		]);
		expect(computeView(createNewGame(1, tuning), tuning).savedDecrees).toEqual(
			[],
		);
	});

	test("apply routes the three commands", () => {
		const state = village();
		const context = contextFor(state);

		const saved = apply(
			state,
			{ type: "saveDecree", name: "plan", decree: harvest("x") },
			tuning,
			context,
		);
		const enacted = apply(
			state,
			{ type: "enactSaved", name: "plan" },
			tuning,
			context,
		);
		const forgotten = apply(
			state,
			{ type: "forgetSaved", name: "plan" },
			tuning,
			context,
		);

		expect([saved.ok, enacted.ok, forgotten.ok]).toEqual([true, true, true]);
	});
});

describe("parseCommand for saved decrees", () => {
	test("accepts each command with a string name", () => {
		expect(
			parseCommand({ type: "saveDecree", name: "a", decree: harvest("a") })
				.type,
		).toBe("saveDecree");
		expect(parseCommand({ type: "enactSaved", name: "a" }).type).toBe(
			"enactSaved",
		);
		expect(parseCommand({ type: "forgetSaved", name: "a" }).type).toBe(
			"forgetSaved",
		);
	});

	test("rejects a saveDecree whose decree is not an object", () => {
		expect(() =>
			parseCommand({ type: "saveDecree", name: "a", decree: 3 }),
		).toThrow("decree must be an object");
	});

	test("rejects a missing or non-string name", () => {
		for (const type of ["saveDecree", "enactSaved", "forgetSaved"]) {
			const decree = harvest("a");
			expect(() => parseCommand({ type, decree })).toThrow(
				"name must be a string",
			);
			expect(() => parseCommand({ type, name: 3, decree })).toThrow(
				"name must be a string",
			);
		}
	});
});
