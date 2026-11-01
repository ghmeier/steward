import { describe, expect, test } from "bun:test";
import villageJson from "../data/village.json";
import { parseCommand } from "../src/core/commands";
import { type Dispute, runDesk, settleDispute } from "../src/core/desk";
import { createNewGame, type GameState } from "../src/core/state";
import { parseTuning } from "../src/core/tuning";
import { validateState } from "../src/core/validate";
import { computeView } from "../src/core/view";
import {
	contextFor,
	fullTuningJson,
	setRoster,
	economyTestTuning as tuning,
} from "./helpers";

const { deskSlots, disputeArrival, grudgeTicks } = tuning.village;

function village(seed = 1, idle = 10): GameState {
	const state = createNewGame(seed, tuning);
	setRoster(state, { idle });
	return state;
}

function dispute(id: number, template: string, parties: [number, number]) {
	return { id, template, parties, arrivedAt: 0 } satisfies Dispute;
}

function holdDisputes(state: GameState, ...held: Dispute[]): void {
	state.posting.desk.disputes = held;
	state.posting.desk.nextDisputeId = (held.at(-1)?.id ?? 0) + 1;
}

function arriveNext(state: GameState): void {
	state.tick = state.posting.desk.nextArrivalTick;
	runDesk(state, tuning, contextFor(state));
}

function settle(state: GameState, id: number, option: string) {
	return settleDispute(state, id, option, tuning, contextFor(state));
}

function peasant(state: GameState, id: number) {
	const found = state.posting.delegates.find((delegate) => delegate.id === id);
	if (found === undefined) throw new Error(`no peasant ${id}`);
	return found;
}

describe("arrivals", () => {
	test("a dispute arrives at nextArrivalTick and not before", () => {
		const state = village();
		const due = state.posting.desk.nextArrivalTick;

		state.tick = due - 1;
		runDesk(state, tuning, contextFor(state));
		expect(state.posting.desk.disputes).toHaveLength(0);

		state.tick = due;
		runDesk(state, tuning, contextFor(state));
		expect(state.posting.desk.disputes).toHaveLength(1);
		expect(state.posting.desk.disputes[0]?.arrivedAt).toBe(due);
	});

	test("the first and every later arrival delay lands within the configured range", () => {
		const state = village();
		const delays = [state.posting.desk.nextArrivalTick];

		for (let i = 0; i < 100; i++) {
			arriveNext(state);
			delays.push(state.posting.desk.nextArrivalTick - state.tick);
		}

		for (const delay of delays) {
			expect(delay).toBeGreaterThanOrEqual(disputeArrival.minTicks);
			expect(delay).toBeLessThanOrEqual(disputeArrival.maxTicks);
		}
		expect(new Set(delays).size).toBeGreaterThan(1);
	});

	test("the two parties are distinct living peasants", () => {
		const state = village(3, 4);
		const living = state.posting.delegates.map((delegate) => delegate.id);

		for (let i = 0; i < 200; i++) {
			arriveNext(state);
			const latest = state.posting.desk.disputes.at(-1) as Dispute;
			const [first, second] = latest.parties;
			expect(first).not.toBe(second);
			expect(living).toContain(first);
			expect(living).toContain(second);
		}
	});

	test("with two peasants both always take part", () => {
		const state = village(3, 2);

		for (let i = 0; i < 20; i++) {
			arriveNext(state);
			const parties = state.posting.desk.disputes.at(-1)?.parties ?? [];
			expect([...parties].sort()).toEqual([1, 2]);
		}
	});

	test("with fewer than two peasants nothing arrives but the next arrival is scheduled", () => {
		const state = village(1, 1);
		const due = state.posting.desk.nextArrivalTick;

		arriveNext(state);

		expect(state.posting.desk.disputes).toHaveLength(0);
		expect(state.posting.desk.nextDisputeId).toBe(1);
		const delay = state.posting.desk.nextArrivalTick - due;
		expect(delay).toBeGreaterThanOrEqual(disputeArrival.minTicks);
		expect(delay).toBeLessThanOrEqual(disputeArrival.maxTicks);
	});

	function sequence(seed: number): string[] {
		const state = village(seed);
		const seen: string[] = [];
		for (let i = 0; i < 30; i++) {
			arriveNext(state);
			const latest = state.posting.desk.disputes.at(-1);
			seen.push(`${state.tick}:${latest?.template}:${latest?.parties}`);
		}
		return seen;
	}

	test("the same seed gives the same disputes and a different seed gives a different run", () => {
		expect(sequence(5)).toEqual(sequence(5));
		expect(sequence(5)).not.toEqual(sequence(6));
	});
});

describe("overflow", () => {
	function overflowing(coin: number) {
		const state = village();
		state.posting.resources.coin = coin;
		state.posting.resources.grain = 50;
		holdDisputes(
			state,
			dispute(1, "boundary", [1, 2]),
			dispute(2, "hen", [3, 4]),
			dispute(3, "hen", [5, 6]),
		);
		return state;
	}

	test("one arrival past deskSlots expires the oldest and keeps the newer disputes", () => {
		const state = overflowing(20);
		expect(state.posting.desk.disputes).toHaveLength(deskSlots);

		arriveNext(state);

		const ids = state.posting.desk.disputes.map((entry) => entry.id);
		expect(ids).toEqual([2, 3, 4]);
		expect(state.posting.resources.coin).toBe(10);
	});

	test("expiry losses are clamped at zero and grudge nobody", () => {
		const state = overflowing(4);

		arriveNext(state);

		expect(state.posting.resources.coin).toBe(0);
		expect(state.posting.resources.grain).toBe(50);
		expect(state.posting.delegates.every((d) => d.grudgeUntil === 0)).toBe(
			true,
		);
	});

	test("a desk exactly full expires nothing", () => {
		const state = village();
		holdDisputes(
			state,
			dispute(1, "boundary", [1, 2]),
			dispute(2, "hen", [3, 4]),
		);

		arriveNext(state);

		expect(state.posting.desk.disputes).toHaveLength(deskSlots);
	});
});

describe("departed parties", () => {
	test("a dispute whose party left is dropped with no resource change or draw", () => {
		const state = village();
		holdDisputes(
			state,
			dispute(1, "boundary", [1, 2]),
			dispute(2, "hen", [3, 4]),
		);
		state.posting.delegates = state.posting.delegates.filter(
			(delegate) => delegate.id !== 2,
		);
		const resources = { ...state.posting.resources };
		const stream = [...(state.posting.rng.disputes as number[])];
		state.tick = state.posting.desk.nextArrivalTick - 1;

		runDesk(state, tuning, contextFor(state));

		expect(state.posting.desk.disputes.map((entry) => entry.id)).toEqual([2]);
		expect(state.posting.resources).toEqual(resources);
		expect(state.posting.rng.disputes).toEqual(stream as never);
	});

	test("a dispute among the living is kept", () => {
		const state = village();
		holdDisputes(state, dispute(1, "boundary", [1, 2]));
		state.tick = state.posting.desk.nextArrivalTick - 1;

		runDesk(state, tuning, contextFor(state));

		expect(state.posting.desk.disputes).toHaveLength(1);
	});
});

describe("settleDispute", () => {
	function contested() {
		const state = village();
		state.tick = 100;
		holdDisputes(
			state,
			dispute(1, "boundary", [1, 2]),
			dispute(2, "hen", [3, 4]),
		);
		return state;
	}

	test("rules for the first party: resources paid and the second party grudged", () => {
		const state = contested();
		const grain = state.posting.resources.grain as number;

		const result = settle(state, 1, "for-first");

		expect(result).toEqual({ ok: true });
		expect(state.posting.resources.grain).toBe(grain + 5);
		expect(peasant(state, 2).grudgeUntil).toBe(state.tick + grudgeTicks);
		expect(peasant(state, 1).grudgeUntil).toBe(0);
	});

	test("rules for the second party: the first party is grudged", () => {
		const state = contested();

		settle(state, 1, "for-second");

		expect(peasant(state, 1).grudgeUntil).toBe(state.tick + grudgeTicks);
		expect(peasant(state, 2).grudgeUntil).toBe(0);
	});

	test("an existing longer grudge is not shortened", () => {
		const state = contested();
		peasant(state, 2).grudgeUntil = state.tick + grudgeTicks + 500;

		settle(state, 1, "for-first");

		expect(peasant(state, 2).grudgeUntil).toBe(state.tick + grudgeTicks + 500);
	});

	test("an existing shorter grudge is extended", () => {
		const state = contested();
		peasant(state, 2).grudgeUntil = state.tick + 10;

		settle(state, 1, "for-first");

		expect(peasant(state, 2).grudgeUntil).toBe(state.tick + grudgeTicks);
	});

	test("removes only the settled dispute", () => {
		const state = contested();
		state.posting.resources.coin = 30;

		settle(state, 1, "pay");

		expect(state.posting.desk.disputes.map((entry) => entry.id)).toEqual([2]);
	});

	test("pays a cost from the stores when affordable", () => {
		const state = contested();
		state.posting.resources.coin = 30;

		const result = settle(state, 1, "pay");

		expect(result).toEqual({ ok: true });
		expect(state.posting.resources.coin).toBe(20);
	});

	test.each([
		["an unknown dispute", 9, "pay", "no dispute 9"],
		["an unknown option", 1, "flog", 'dispute 1 has no option "flog"'],
		["an unaffordable option", 1, "pay", "not enough coin (need 10, have 4.2)"],
	])(
		"rejects %s and leaves the state unchanged",
		(_name, id, option, reason) => {
			const state = contested();
			state.posting.resources.coin = 4.2;
			const before = structuredClone(state);

			const result = settle(state, id, option);

			expect(result).toEqual({ ok: false, reason });
			expect(state).toEqual(before);
		},
	);

	test("throws a clear error when a stored template no longer exists", () => {
		const state = contested();
		state.posting.desk.disputes[0] = dispute(1, "vanished", [1, 2]);

		expect(() => settle(state, 1, "pay")).toThrow("vanished");
		expect(() => runDesk(state, tuning, contextFor(state))).toThrow("vanished");
	});
});

describe("settleDispute command", () => {
	test("parseCommand accepts the shape and rejects bad fields", () => {
		expect(
			parseCommand({ type: "settleDispute", dispute: 2, option: "pay" }),
		).toEqual({ type: "settleDispute", dispute: 2, option: "pay" });
		expect(() =>
			parseCommand({ type: "settleDispute", dispute: "2", option: "pay" }),
		).toThrow("dispute");
		expect(() =>
			parseCommand({ type: "settleDispute", dispute: 1.5, option: "pay" }),
		).toThrow("dispute");
		expect(() =>
			parseCommand({ type: "settleDispute", dispute: 2, option: 1 }),
		).toThrow("option");
	});
});

describe("view desk", () => {
	function viewed(grain: number) {
		const state = village();
		state.posting.resources.grain = grain;
		holdDisputes(state, dispute(1, "hen", [1, 2]));
		return computeView(state, tuning).desk;
	}

	test("substitutes party names into the label and option labels", () => {
		const state = village();
		holdDisputes(state, dispute(1, "boundary", [2, 3]));
		const [first, second] = [peasant(state, 2).name, peasant(state, 3).name];

		const [entry] = computeView(state, tuning).desk;

		expect(entry?.label).toBe(`${first} accuses ${second} of moving a stone.`);
		expect(entry?.options.map((option) => option.label)).toEqual([
			"Pay the surveyor",
			`Rule for ${first}`,
			`Rule for ${second}`,
		]);
	});

	test("marks the expiry option and keeps desk order", () => {
		const state = village();
		holdDisputes(
			state,
			dispute(1, "hen", [1, 2]),
			dispute(2, "boundary", [3, 4]),
		);

		const desk = computeView(state, tuning).desk;

		expect(desk.map((entry) => entry.id)).toEqual([1, 2]);
		expect(desk[0]?.options.map((option) => option.expiry)).toEqual([
			true,
			false,
		]);
	});

	test("an option is affordable when the village holds its cost and not when it falls short", () => {
		expect(viewed(10)[0]?.options[0]?.affordable).toBe(true);
		expect(viewed(9.9)[0]?.options[0]?.affordable).toBe(false);
		expect(viewed(9.9)[0]?.options[1]?.affordable).toBe(true);
	});
});

describe("village tuning parse", () => {
	const base = JSON.parse(JSON.stringify(villageJson)) as typeof villageJson;
	// biome-ignore lint/suspicious/noExplicitAny: test mutates arbitrary JSON paths
	type Mutable = Record<string, any>;

	function parseWith(change: (village: Mutable) => void): unknown {
		const village = structuredClone(base) as Mutable;
		change(village);
		return parseTuning({ ...fullTuningJson, village });
	}

	const bad: [string, (village: Mutable) => void, string][] = [
		[
			"an empty template list",
			(v) => {
				v.disputes = [];
			},
			"disputes",
		],
		[
			"a repeated template id",
			(v) => {
				v.disputes[1].id = v.disputes[0].id;
			},
			"repeats id",
		],
		[
			"a repeated option id",
			(v) => {
				v.disputes[0].options[1].id = v.disputes[0].options[0].id;
			},
			"repeats option id",
		],
		[
			"fewer than two options",
			(v) => void v.disputes[0].options.splice(1),
			"at least 2",
		],
		[
			"an expiry naming no option",
			(v) => {
				v.disputes[0].expiry = "nothing";
			},
			"expiry",
		],
		[
			"an unknown resource",
			(v) => {
				v.disputes[0].options[0].resources = { gold: -1 };
			},
			"unknown resource",
		],
		[
			"a non-finite amount",
			(v) => {
				v.disputes[0].options[0].resources = { coin: "lots" };
			},
			"finite",
		],
		[
			"an unknown placeholder in the text",
			(v) => {
				v.disputes[0].text = "{third} is cross";
			},
			"{third}",
		],
		[
			"an unknown placeholder in an option label",
			(v) => {
				v.disputes[0].options[0].label = "Ask {nobody}";
			},
			"{nobody}",
		],
		[
			"an expiry option that grudges",
			(v) => {
				const expiry = v.disputes[0].expiry;
				const option = v.disputes[0].options.find(
					(o: Mutable) => o.id === expiry,
				);
				option.grudge = "first";
			},
			"must not grudge",
		],
		[
			"an expiry option that gains a resource",
			(v) => {
				const expiry = v.disputes[0].expiry;
				const option = v.disputes[0].options.find(
					(o: Mutable) => o.id === expiry,
				);
				option.resources = { coin: 3 };
			},
			"must not gain",
		],
		[
			"a zero deskSlots",
			(v) => {
				v.deskSlots = 0;
			},
			"deskSlots",
		],
		[
			"a zero promotionPopulation",
			(v) => {
				v.promotionPopulation = 0;
			},
			"promotionPopulation",
		],
		[
			"a fractional promotionPopulation",
			(v) => {
				v.promotionPopulation = 12.5;
			},
			"promotionPopulation",
		],
		[
			"a promotionPopulation above maxPopulation",
			(v) => {
				v.promotionPopulation = 10_000;
			},
			"promotionPopulation",
		],
		[
			"a fractional grudgeTicks",
			(v) => {
				v.grudgeTicks = 1.5;
			},
			"grudgeTicks",
		],
		[
			"minTicks above maxTicks",
			(v) => {
				v.disputeArrival = { minTicks: 20, maxTicks: 10 };
			},
			"minTicks",
		],
	];

	test.each(bad)("rejects %s", (_name, change, message) => {
		expect(() => parseWith(change)).toThrow(message);
	});
});

describe("desk validation", () => {
	// biome-ignore lint/suspicious/noExplicitAny: test mutates arbitrary state paths
	type Tree = Record<string, any>;

	function set(node: Tree, key: string, value: unknown): void {
		node[key] = value;
	}

	function problemsWith(change: (desk: Tree) => void): string {
		const state = village() as unknown as Tree;
		state.tick = 50;
		const desk = state.posting.desk;
		desk.nextDisputeId = 5;
		desk.disputes = [
			{ id: 1, template: "hen", parties: [1, 2], arrivedAt: 10 },
			{ id: 3, template: "hen", parties: [3, 4], arrivedAt: 20 },
		];
		change(desk);
		return validateState(state).join("\n");
	}

	test("accepts a well-formed desk", () => {
		expect(problemsWith(() => {})).toBe("");
	});

	const D = "$.posting.desk";
	const bad: [string, (desk: Tree) => void, string][] = [
		[
			"a zero dispute id",
			(d) => void set(d.disputes[0], "id", 0),
			`${D}.disputes[0].id`,
		],
		[
			"a repeated id",
			(d) => void set(d.disputes[1], "id", 1),
			`${D}.disputes[1].id`,
		],
		[
			"ids out of order",
			(d) => void set(d.disputes[0], "id", 4),
			`${D}.disputes[1].id`,
		],
		[
			"an id at nextDisputeId",
			(d) => void set(d.disputes[1], "id", 5),
			`${D}.disputes[1].id`,
		],
		[
			"identical parties",
			(d) => void set(d.disputes[0], "parties", [1, 1]),
			`${D}.disputes[0].parties`,
		],
		[
			"a party outside the roster",
			(d) => void set(d.disputes[0], "parties", [1, 99]),
			`${D}.disputes[0].parties`,
		],
		[
			"an empty template id",
			(d) => void set(d.disputes[0], "template", ""),
			`${D}.disputes[0].template`,
		],
		[
			"arrival after the tick",
			(d) => void set(d.disputes[0], "arrivedAt", 51),
			`${D}.disputes[0].arrivedAt`,
		],
		[
			"a fractional arrivedAt",
			(d) => void set(d.disputes[0], "arrivedAt", 1.5),
			`${D}.disputes[0].arrivedAt`,
		],
		[
			"a negative nextArrivalTick",
			(d) => void set(d, "nextArrivalTick", -1),
			`${D}.nextArrivalTick`,
		],
		[
			"a zero nextDisputeId",
			(d) => void set(d, "nextDisputeId", 0),
			`${D}.nextDisputeId`,
		],
	];

	test.each(bad)("rejects %s", (_name, change, path) => {
		expect(problemsWith(change)).toContain(`${path}:`);
	});
});
