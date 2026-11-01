import { describe, expect, test } from "bun:test";
import {
  contextFor,
  setRoster,
  economyTestTuning as tuning,
} from "../../test/helpers";
import type { Dispute } from "./desk";
import { Game } from "./game";

const { disputeArrival, grudgeTicks } = tuning.village;

function village(seed = 1, idle = 10): Game {
  const game = Game.create(seed, tuning);
  setRoster(game, { idle });
  return game;
}

function dispute(id: number, template: string, parties: [number, number]) {
  return { id, template, parties, arrivedAt: 0 } satisfies Dispute;
}

/** The nth disjoint pair of peasants, taken from the game's real roster. */
function pair(game: Game, n: number): [number, number] {
  const [first, second] = game.delegates.all.slice(2 * n, 2 * n + 2);
  if (!first || !second) throw new Error(`no peasant pair ${n}`);
  return [first.id, second.id];
}

function holdDisputes(game: Game, ...held: Dispute[]): void {
  game.state.posting.desk.disputes = held;
  game.state.posting.desk.nextDisputeId = (held.at(-1)?.id ?? 0) + 1;
}

function arriveNext(game: Game): void {
  game.state.tick = game.state.posting.desk.nextArrivalTick;
  game.desk.run(contextFor(game));
}

function settle(game: Game, id: number, option: string) {
  return game.desk.settle(id, option, contextFor(game));
}

function peasant(game: Game, id: number) {
  const found = game.delegates.findById(id);
  if (found === undefined) throw new Error(`no peasant ${id}`);
  return found;
}

describe("arrivals", () => {
  test.each([2, 4])(
    "with %p peasants nothing arrives early, then every arrival has two distinct living parties and a delay in range",
    (peasants) => {
      const game = village(3, peasants);
      const living = game.state.posting.delegates.map(
        (delegate) => delegate.id,
      );
      const delays = [game.state.posting.desk.nextArrivalTick];

      game.state.tick = (delays[0] as number) - 1;
      game.desk.run(contextFor(game));
      expect(game.state.posting.desk.disputes).toHaveLength(0);
      for (let i = 0; i < 100; i++) {
        arriveNext(game);
        delays.push(game.state.posting.desk.nextArrivalTick - game.state.tick);
        const latest = game.state.posting.desk.disputes.at(-1) as Dispute;
        expect(latest.arrivedAt).toBe(game.state.tick);
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
    const game = village(1, 1);
    const due = game.state.posting.desk.nextArrivalTick;

    arriveNext(game);

    const delay = game.state.posting.desk.nextArrivalTick - due;
    expect(game.state.posting.desk.disputes).toHaveLength(0);
    expect(game.state.posting.desk.nextDisputeId).toBe(1);
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
    const game = village();
    game.state.posting.resources.coin = coin;
    game.state.posting.resources.grain = 50;
    holdDisputes(
      game,
      ...[
        dispute(1, "boundary", pair(game, 0)),
        dispute(2, "hen", pair(game, 1)),
        dispute(3, "hen", pair(game, 2)),
      ].slice(0, held),
    );

    arriveNext(game);

    expect(game.state.posting.desk.disputes.map((entry) => entry.id)).toEqual(
      ids,
    );
    expect(game.state.posting.resources.coin).toBe(coinAfter);
    expect(game.state.posting.resources.grain).toBe(50);
    expect(game.state.posting.delegates.every((d) => d.grudgeUntil === 0)).toBe(
      true,
    );
  });
});

describe("departed parties", () => {
  test("a dispute whose party left is dropped with no resource change or draw, and the others stay", () => {
    const game = village();
    const [departing] = pair(game, 0);
    holdDisputes(
      game,
      dispute(1, "boundary", pair(game, 0)),
      dispute(2, "hen", pair(game, 1)),
    );
    game.delegates.remove(departing);
    const resources = { ...game.state.posting.resources };
    const stream = [...(game.state.posting.rng.disputes as number[])];
    game.state.tick = game.state.posting.desk.nextArrivalTick - 1;

    game.desk.run(contextFor(game));

    expect(game.state.posting.desk.disputes.map((entry) => entry.id)).toEqual([
      2,
    ]);
    expect(game.state.posting.resources).toEqual(resources);
    expect(game.state.posting.rng.disputes).toEqual(stream as never);
  });
});

describe("settleDispute", () => {
  function contested() {
    const game = village();
    game.state.tick = 100;
    holdDisputes(
      game,
      dispute(1, "boundary", pair(game, 0)),
      dispute(2, "hen", pair(game, 1)),
    );
    return game;
  }

  type Outcome = {
    name: string;
    option: string;
    grudged?: "first" | "second";
    existing?: number;
    grudgedUntil?: number;
    grain: number;
    coin: number;
  };
  // The village holds 30 coin; the grudge runs to tick 700 unless a longer one was already there.
  // biome-ignore format: one row per case
  const outcomes: Outcome[] = [
		{ name: "for-first pays the reward and grudges the second party", option: "for-first", grudged: "second", grudgedUntil: 700, grain: 5, coin: 0 },
		{ name: "for-second grudges the first party", option: "for-second", grudged: "first", grudgedUntil: 700, grain: 0, coin: 0 },
		{ name: "a longer grudge is not shortened", option: "for-first", grudged: "second", existing: 1100, grudgedUntil: 1100, grain: 5, coin: 0 },
		{ name: "a shorter grudge is extended", option: "for-first", grudged: "second", existing: 110, grudgedUntil: 700, grain: 5, coin: 0 },
		{ name: "pay spends the cost and grudges nobody", option: "pay", grain: 0, coin: -10 },
	];

  test.each(outcomes)(
    "$name",
    ({ option, grudged, existing = 0, grudgedUntil = 0, grain, coin }) => {
      const game = contested();
      game.state.posting.resources.coin = 30;
      const grainBefore = game.state.posting.resources.grain as number;
      expect(game.state.tick + grudgeTicks).toBe(700);
      const parties = { first: pair(game, 0)[0], second: pair(game, 0)[1] };
      if (grudged) peasant(game, parties[grudged]).grudgeUntil = existing;

      expect(settle(game, 1, option)).toEqual({ ok: true });

      for (const side of ["first", "second"] as const) {
        expect(peasant(game, parties[side]).grudgeUntil).toBe(
          side === grudged ? grudgedUntil : 0,
        );
      }
      expect(game.state.posting.resources.grain).toBe(grainBefore + grain);
      expect(game.state.posting.resources.coin).toBe(30 + coin);
      expect(game.state.posting.desk.disputes.map((entry) => entry.id)).toEqual(
        [2],
      );
    },
  );

  test.each([
    ["an unknown dispute", 9, "pay", "no dispute 9"],
    ["an unknown option", 1, "flog", 'dispute 1 has no option "flog"'],
    ["an unaffordable option", 1, "pay", "not enough coin (need 10, have 4.2)"],
  ])(
    "rejects %s and leaves the state unchanged",
    (_name, id, option, reason) => {
      const game = contested();
      game.state.posting.resources.coin = 4.2;
      const before = structuredClone(game.state);

      const result = settle(game, id, option);

      expect(result).toEqual({ ok: false, reason });
      expect(game.state).toEqual(before);
    },
  );

  test("throws a clear error when a stored template no longer exists", () => {
    const game = contested();
    game.state.posting.desk.disputes[0] = dispute(1, "vanished", pair(game, 0));

    expect(() => settle(game, 1, "pay")).toThrow("vanished");
    expect(() => game.desk.run(contextFor(game))).toThrow("vanished");
  });
});

describe("view desk", () => {
  test("entries keep desk order and carry names, resources, grudge and expiry for each option", () => {
    const game = village();
    const [a, b, c] = game.delegates.all;
    if (!a || !b || !c) throw new Error("expected three peasants");
    holdDisputes(
      game,
      dispute(1, "boundary", [b.id, c.id]),
      dispute(2, "hen", [a.id, b.id]),
    );
    const [first, second] = [b.name, c.name];

    const desk = game.view.compute().desk;

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
      const game = village();
      game.state.posting.resources.grain = grain;
      holdDisputes(game, dispute(1, "hen", pair(game, 0)));

      const options = game.view.compute().desk[0]?.options;

      expect(options?.[0]?.affordable).toBe(affordable);
      expect(options?.[1]?.affordable).toBe(true);
    },
  );
});
