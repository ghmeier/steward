import { describe, expect, test } from "bun:test";
import { type Dispute, runDesk, settleDispute } from "../src/core/desk";
import { createNewGame, type GameState } from "../src/core/state";
import { computeView } from "../src/core/view";
import { contextFor, setRoster, economyTestTuning as tuning } from "./helpers";

const { disputeArrival, grudgeTicks } = tuning.village;

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
	test.each([2, 4])(
		"with %p peasants nothing arrives early, then every arrival has two distinct living parties and a delay in range",
		(peasants) => {
			const state = village(3, peasants);
			const living = state.posting.delegates.map((delegate) => delegate.id);
			const delays = [state.posting.desk.nextArrivalTick];

			state.tick = (delays[0] as number) - 1;
			runDesk(state, tuning, contextFor(state));
			expect(state.posting.desk.disputes).toHaveLength(0);
			for (let i = 0; i < 100; i++) {
				arriveNext(state);
				delays.push(state.posting.desk.nextArrivalTick - state.tick);
				const latest = state.posting.desk.disputes.at(-1) as Dispute;
				expect(latest.arrivedAt).toBe(state.tick);
				expect(latest.parties[0]).not.toBe(latest.parties[1]);
				expect(living).toContain(latest.parties[0]);
				expect(living).toContain(latest.parties[1]);
			}

			for (const delay of delays) {
				expect(delay).toBeGreaterThanOrEqual(disputeArrival.minTicks);
				expect(delay).toBeLessThanOrEqual(disputeArrival.maxTicks);
			}
			expect(new Set(delays).size).toBeGreaterThan(1);
		},
	);

	test("with fewer than two peasants nothing arrives but the next arrival is scheduled", () => {
		const state = village(1, 1);
		const due = state.posting.desk.nextArrivalTick;

		arriveNext(state);

		const delay = state.posting.desk.nextArrivalTick - due;
		expect(state.posting.desk.disputes).toHaveLength(0);
		expect(state.posting.desk.nextDisputeId).toBe(1);
		expect(delay).toBeGreaterThanOrEqual(disputeArrival.minTicks);
		expect(delay).toBeLessThanOrEqual(disputeArrival.maxTicks);
	});
});

describe("overflow", () => {
	type Row = {
		name: string;
		held: number;
		coin: number;
		ids: number[];
		coinAfter: number;
	};
	// biome-ignore format: one row per case
	const rows: Row[] = [
		{ name: "expires the oldest and charges its default", held: 3, coin: 20, ids: [2, 3, 4], coinAfter: 10 },
		{ name: "clamps the default's loss at zero coin", held: 3, coin: 4, ids: [2, 3, 4], coinAfter: 0 },
		{ name: "expires nothing when the desk is exactly full after the arrival", held: 2, coin: 20, ids: [1, 2, 3], coinAfter: 20 },
	];

	test.each(rows)("a desk that $name", ({ held, coin, ids, coinAfter }) => {
		const state = village();
		state.posting.resources.coin = coin;
		state.posting.resources.grain = 50;
		holdDisputes(
			state,
			...[
				dispute(1, "boundary", [1, 2]),
				dispute(2, "hen", [3, 4]),
				dispute(3, "hen", [5, 6]),
			].slice(0, held),
		);

		arriveNext(state);

		expect(state.posting.desk.disputes.map((entry) => entry.id)).toEqual(ids);
		expect(state.posting.resources.coin).toBe(coinAfter);
		expect(state.posting.resources.grain).toBe(50);
		expect(state.posting.delegates.every((d) => d.grudgeUntil === 0)).toBe(
			true,
		);
	});
});

describe("departed parties", () => {
	test("a dispute whose party left is dropped with no resource change or draw, and the others stay", () => {
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

	type Outcome = {
		name: string;
		option: string;
		grudged?: number;
		existing?: number;
		grudgedUntil?: number;
		grain: number;
		coin: number;
	};
	// The village holds 30 coin; the grudge runs to tick 700 unless a longer one was already there.
	// biome-ignore format: one row per case
	const outcomes: Outcome[] = [
		{ name: "for-first pays the reward and grudges the second party", option: "for-first", grudged: 2, grudgedUntil: 700, grain: 5, coin: 0 },
		{ name: "for-second grudges the first party", option: "for-second", grudged: 1, grudgedUntil: 700, grain: 0, coin: 0 },
		{ name: "a longer grudge is not shortened", option: "for-first", grudged: 2, existing: 1100, grudgedUntil: 1100, grain: 5, coin: 0 },
		{ name: "a shorter grudge is extended", option: "for-first", grudged: 2, existing: 110, grudgedUntil: 700, grain: 5, coin: 0 },
		{ name: "pay spends the cost and grudges nobody", option: "pay", grain: 0, coin: -10 },
	];

	test.each(outcomes)(
		"$name",
		({ option, grudged, existing = 0, grudgedUntil = 0, grain, coin }) => {
			const state = contested();
			state.posting.resources.coin = 30;
			const grainBefore = state.posting.resources.grain as number;
			expect(state.tick + grudgeTicks).toBe(700);
			if (grudged) peasant(state, grudged).grudgeUntil = existing;

			expect(settle(state, 1, option)).toEqual({ ok: true });

			for (const id of [1, 2]) {
				expect(peasant(state, id).grudgeUntil).toBe(
					id === grudged ? grudgedUntil : 0,
				);
			}
			expect(state.posting.resources.grain).toBe(grainBefore + grain);
			expect(state.posting.resources.coin).toBe(30 + coin);
			expect(state.posting.desk.disputes.map((entry) => entry.id)).toEqual([2]);
		},
	);

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

describe("view desk", () => {
	test("entries keep desk order and carry names, resources, grudge and expiry for each option", () => {
		const state = village();
		holdDisputes(
			state,
			dispute(1, "boundary", [2, 3]),
			dispute(2, "hen", [1, 2]),
		);
		const [first, second] = [peasant(state, 2).name, peasant(state, 3).name];

		const desk = computeView(state, tuning).desk;

		expect(desk.map((entry) => entry.id)).toEqual([1, 2]);
		expect(desk[0]?.parties).toEqual([first, second]);
		expect(desk[0]?.label).toContain(`${first} accuses ${second}`);
		const byId = Object.fromEntries(
			(desk[0]?.options ?? []).map((option) => [option.id, option]),
		);
		expect(byId.pay).toMatchObject({
			label: "Pay the surveyor",
			resources: { coin: -10 },
			grudge: "none",
			expiry: true,
		});
		expect(byId["for-first"]).toMatchObject({
			label: `Rule for ${first}`,
			resources: { grain: 5 },
			grudge: "second",
			expiry: false,
		});
		expect(byId["for-second"]).toMatchObject({
			label: `Rule for ${second}`,
			resources: {},
			grudge: "first",
		});
	});

	test.each([
		["exactly enough grain", 10, true],
		["just short of the grain", 9.9, false],
	])(
		"an option costing 10 grain is affordable with %s only when covered",
		(_n, grain, affordable) => {
			const state = village();
			state.posting.resources.grain = grain;
			holdDisputes(state, dispute(1, "hen", [1, 2]));

			const options = computeView(state, tuning).desk[0]?.options;

			expect(options?.[0]?.affordable).toBe(affordable);
			expect(options?.[1]?.affordable).toBe(true);
		},
	);
});
