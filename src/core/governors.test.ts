import { describe, expect, test } from "bun:test";
import {
  addGovernors,
  contextFor,
  governorOf,
  quietOptions,
  setRoster,
  tuning,
} from "../../test/helpers";
import { copy } from "./copy";
import type { Governor } from "./delegates";
import type { Candidate } from "./desk";
import { Game } from "./game";
import { Job, type Trait } from "./realm";

const ticksPerSeason = tuning.economy.ticksPerSeason;

function posted(peasants = 3, ...governors: Governor[]): Game {
  const game = Game.create(1, tuning);
  setRoster(game, { idle: peasants });
  addGovernors(game, ...governors);
  return game;
}

function governorsOf(game: Game): Governor[] {
  return game.delegates.governors;
}

function candidateOf(game: Game, fields: Partial<Candidate> = {}): Candidate {
  const { desk } = game.state.posting;
  const candidate: Candidate = {
    id: desk.nextDisputeId,
    kind: "candidate",
    template: "recommended",
    arrivedAt: game.state.tick,
    name: "Candidate",
    job: Job.FARM,
    village: 7,
    traits: ["diligent"],
    price: 90,
    term: 4000,
    ...fields,
  };
  desk.disputes.push(candidate);
  desk.nextDisputeId += 1;
  return candidate;
}

function stepTo(game: Game, tick: number): void {
  while (game.state.tick < tick) game.steps.step([], quietOptions);
}

describe("population", () => {
  test("counts one for each peasant and the whole village of each governor", () => {
    const game = posted(
      3,
      governorOf({ village: 8 }),
      governorOf({ village: 6 }),
    );

    expect(game.delegates.population).toBe(17);
    expect(game.view.compute().realm.population).toBe(17);
    expect(game.illusion.ceiling).toBe(tuning.illusion.ceilingPerPeasant * 17);
  });

  test("does not count governors against the cap on peasants", () => {
    const game = posted(
      tuning.economy.maxPopulation - 1,
      governorOf({ village: 10 }),
    );

    expect(game.economy.hasRoom).toBe(true);
  });

  test("promotes a village that reaches the promotion population through its governors", () => {
    const game = posted(
      tuning.village.promotionPopulation - 8,
      governorOf({ village: 8 }),
    );

    game.steps.step([], quietOptions);

    expect(game.state.career.promotedAt).toBe(game.state.tick);
  });
});

describe("a village without governors", () => {
  test("has a population and working counts equal to its peasant head counts", () => {
    const game = Game.create(1, tuning);
    setRoster(game, { farm: 3, forest: 2, mine: 1, idle: 4 });

    expect(game.delegates.population).toBe(10);
    expect(game.delegates.workingCountsAt(1)).toEqual(
      game.delegates.jobCounts(),
    );
  });
});

describe("trait factors", () => {
  test.each<[Trait, number, number]>([
    ["diligent", 11.5, 11.5],
    ["skimmer", 8, 10],
    ["braggart", 10, 14],
    ["hoarder", 9, 9],
    ["empire-builder", 10, 12],
  ])(
    "%s on a village of ten works %f and reports %f workers",
    (trait, real, reported) => {
      const game = posted(0, governorOf({ village: 10, traits: [trait] }));
      const [governor] = governorsOf(game);
      if (governor === undefined) throw new Error("no governor");

      expect(game.governors.workersOf(governor)).toBeCloseTo(real, 9);
      expect(game.governors.reportedWorkersOf(governor)).toBeCloseTo(
        reported,
        9,
      );
    },
  );

  test("two traits multiply", () => {
    const game = posted(
      0,
      governorOf({ village: 10, traits: ["diligent", "hoarder"] }),
    );
    const [governor] = governorsOf(game);
    if (governor === undefined) throw new Error("no governor");

    expect(game.governors.workersOf(governor)).toBeCloseTo(10 * 1.15 * 0.9, 9);
  });
});

describe("worker-weighted counts", () => {
  test("a governor adds their village scaled by traits to their job and a peasant adds one", () => {
    const game = posted(
      0,
      governorOf({ job: Job.FOREST, village: 10, traits: ["skimmer"] }),
    );
    setRoster(game, { farm: 2 });
    addGovernors(
      game,
      governorOf({ job: Job.FOREST, village: 10, traits: ["skimmer"] }),
    );

    const counts = game.delegates.workingCountsAt(1);

    expect(counts.farm).toBe(2);
    expect(counts.forest).toBeCloseTo(8, 9);
  });

  test("a governor holding a grudge idles their whole village", () => {
    const game = posted(0, governorOf({ village: 8, grudgeUntil: 50 }));

    expect(game.delegates.workingCountsAt(49).idle).toBe(8);
    expect(game.delegates.workingCountsAt(50).idle).toBe(0);
    expect(game.delegates.workingCountsAt(50).farm).toBe(8);
  });

  test("grain upkeep feeds a governor's village in full and idle peasants at the idle share", () => {
    const game = posted(2, governorOf({ job: Job.IDLE, village: 8 }));
    game.state.posting.resources.grain = 100;

    game.economy.run(contextFor(game));

    expect(game.state.posting.resources.grain).toBeCloseTo(
      100 -
        (8 + 2 * tuning.economy.idleGrainFactor) *
          tuning.economy.grainPerPerson,
      9,
    );
  });

  test("famine kills peasants and leaves governors and their villages alone", () => {
    const game = posted(4, governorOf({ job: Job.MINE, village: 8 }));
    game.state.posting.resources.grain = 0;
    game.state.tick = ticksPerSeason * 3;
    game.state.posting.economy.famine = {
      startPopulation: 4,
      ticks: ticksPerSeason - 1,
      deaths: 0,
    };

    game.economy.run(contextFor(game));

    expect(governorsOf(game)).toHaveLength(1);
    expect(game.delegates.peasants).toHaveLength(2);
    expect(game.delegates.jobCounts().mine).toBe(0);
  });
});

describe("labor decrees", () => {
  test("divide the peasants alone, so a governor's village is not counted in the targets", () => {
    const game = posted(5, governorOf({ job: Job.MINE, village: 8 }));

    const targets = game.economy.laborTargetFor("farm");

    expect(targets.farm).toBe(5);
  });

  test("never move a governor, even when they are the only one free", () => {
    const game = posted(0, governorOf({ job: Job.IDLE, village: 8 }));

    const settled = game.economy.moveLaborToward({
      farm: 0,
      forest: 0,
      mine: 0,
      idle: 0,
    });

    expect(settled).toBe(true);
    expect(governorsOf(game)[0]?.job).toBe(Job.IDLE);
  });
});

describe("reported output", () => {
  test("a skimmer's displayed grain rate exceeds the real flow while the stock gains only the real flow", () => {
    const game = posted(0, governorOf({ village: 10, traits: ["skimmer"] }));
    game.state.posting.resources.grain = 1000;
    const before = game.state.posting.resources.grain;
    const perSecond = 1000 / tuning.stepMs;

    const displayed = game.view
      .compute()
      .ledger.find((l) => l.resource === "grain");
    game.steps.step([], quietOptions);
    const landed = game.state.posting.resources.grain - before;

    // Ten workers are claimed and eight work, and spring yields the base rate.
    const unreportedGrain = (10 - 8) * tuning.economy.grainPerFarmer;
    expect(displayed?.ratePerSecond).toBeCloseTo(
      (landed + unreportedGrain) * perSecond,
      9,
    );
    expect(displayed?.ratePerSecond ?? 0).toBeGreaterThan(landed * perSecond);
  });

  test("an honest governor's displayed rate matches the real flow", () => {
    const game = posted(0, governorOf({ village: 10, traits: ["diligent"] }));
    game.state.posting.resources.grain = 1000;
    const before = game.state.posting.resources.grain;

    const displayed = game.view
      .compute()
      .ledger.find((l) => l.resource === "grain");
    game.steps.step([], quietOptions);
    const landed = game.state.posting.resources.grain - before;

    expect(displayed?.ratePerSecond).toBeCloseTo(
      (landed * 1000) / tuning.stepMs,
      9,
    );
  });

  test("the governor's row shows the reported output of their job", () => {
    const game = posted(
      0,
      governorOf({ village: 10, job: Job.MINE, traits: ["braggart"] }),
    );
    const [governor] = governorsOf(game);

    const [row] = game.view.compute().governors;

    expect(row).toEqual({
      id: governor?.id as number,
      name: governor?.name as string,
      job: Job.MINE,
      village: 10,
      traits: ["braggart"],
      resource: "ore",
      reportedPerSecond:
        (10 * 1.4 * tuning.economy.orePerWorker * 1000) / tuning.stepMs,
      truth: null,
      seasonsLeft: Math.ceil((governor?.termEndsAt as number) / ticksPerSeason),
    });
  });
});

describe("terms", () => {
  test("seasonsLeft counts down by one across a season", () => {
    const game = posted(
      3,
      governorOf({ termEndsAt: 3 * ticksPerSeason + 1, job: Job.IDLE }),
    );
    const calm = Game.fromState(game.state, {
      ...tuning,
      governors: { ...tuning.governors, deathPerMille: 0 },
    });
    const before = calm.view.compute().governors[0]?.seasonsLeft;

    stepTo(calm, ticksPerSeason);
    const after = calm.view.compute().governors[0]?.seasonsLeft;

    expect(before).toBe(4);
    expect(after).toBe((before as number) - 1);
  });

  test("a governor who dies is recorded with a cause from the tuning list, and one who retires has none", () => {
    const deadly = Game.fromState(
      structuredClone(posted(3, governorOf()).state),
      { ...tuning, governors: { ...tuning.governors, deathPerMille: 1000 } },
    );
    const retiring = posted(3, governorOf({ termEndsAt: 1 }));

    stepTo(deadly, ticksPerSeason);
    stepTo(retiring, 1);

    expect(tuning.governors.causes).toContain(
      deadly.state.posting.formerStaff[0]?.cause as string,
    );
    expect(retiring.state.posting.formerStaff[0]?.cause).toBeUndefined();
  });

  test("the death chance getter reads the tuning", () => {
    const game = posted(3);

    expect(game.governors.deathPerMille).toBe(tuning.governors.deathPerMille);
  });

  test("a governor retires when their term ends and is recorded as former staff", () => {
    const game = posted(
      3,
      governorOf({ traits: ["diligent"], hiredAt: 0, termEndsAt: 5 }),
    );
    const [governor] = governorsOf(game);

    stepTo(game, 4);
    const stillServing = governorsOf(game).length;
    stepTo(game, 5);

    expect(stillServing).toBe(1);
    expect(governorsOf(game)).toEqual([]);
    expect(game.state.posting.formerStaff).toEqual([
      {
        name: governor?.name as string,
        traits: ["diligent"],
        hiredAt: 0,
        leftAt: 5,
        reason: "retired",
        handedOver: 0,
      },
    ]);
  });

  test("a governor may die at the end of a season, and only then", () => {
    const deadly = Game.fromState(
      structuredClone(posted(3, governorOf()).state),
      { ...tuning, governors: { ...tuning.governors, deathPerMille: 1000 } },
    );

    stepTo(deadly, ticksPerSeason - 1);
    const survivedMidSeason = governorsOf(deadly).length;
    stepTo(deadly, ticksPerSeason);

    expect(survivedMidSeason).toBe(1);
    expect(governorsOf(deadly)).toEqual([]);
    expect(deadly.state.posting.formerStaff[0]?.reason).toBe("died");
  });

  test("an empire-builder gains a peasant each season up to the limit, and others do not", () => {
    const game = posted(
      3,
      governorOf({
        village: tuning.governors.empireBuilderLimit - 1,
        traits: ["empire-builder"],
      }),
      governorOf({ village: 8, traits: ["diligent"] }),
    );
    // A season's death roll must not remove either governor.
    const calm = Game.fromState(game.state, {
      ...tuning,
      governors: { ...tuning.governors, deathPerMille: 0 },
    });

    stepTo(calm, ticksPerSeason);
    stepTo(calm, 2 * ticksPerSeason);

    const [builder, other] = governorsOf(calm);
    expect(builder?.village).toBe(tuning.governors.empireBuilderLimit);
    expect(other?.village).toBe(8);
  });
});

describe("hoard", () => {
  test("a hoarder's kept share grows while they work and an honest governor keeps nothing", () => {
    const game = posted(
      0,
      governorOf({ village: 10, job: Job.MINE, traits: ["hoarder"] }),
      governorOf({ village: 10, job: Job.MINE, traits: ["diligent"] }),
    );

    stepTo(game, 10);

    const [hoarder, honest] = governorsOf(game);
    const keptPerTick =
      10 * (1 - 0.9) * tuning.economy.orePerWorker * tuning.economy.orePrice;
    expect(hoarder?.hoard).toBeCloseTo(10 * keptPerTick, 9);
    expect(honest?.hoard).toBe(0);
  });

  test("the hoard is paid out in coin when the governor leaves", () => {
    const game = posted(
      3,
      governorOf({ job: Job.IDLE, hoard: 50, termEndsAt: 2 }),
    );

    stepTo(game, 1);
    const coinWhileServing = game.state.posting.resources.coin;
    stepTo(game, 2);

    expect(coinWhileServing).toBe(0);
    expect(game.state.posting.resources.coin).toBe(50);
    expect(game.state.posting.formerStaff[0]?.handedOver).toBe(50);
  });
});

describe("failed audits", () => {
  test("dismiss the governor whose report outruns their output by the most", () => {
    const game = posted(
      3,
      governorOf({ traits: ["skimmer"] }),
      governorOf({ traits: ["braggart"] }),
      governorOf({ traits: ["diligent"] }),
    );
    const [, braggart] = governorsOf(game);

    game.illusion.failAudit(contextFor(game));

    expect(governorsOf(game).map((g) => g.traits[0])).toEqual([
      "skimmer",
      "diligent",
    ]);
    expect(game.state.posting.formerStaff).toMatchObject([
      { name: braggart?.name as string, reason: "dismissed" },
    ]);
  });

  test("dismiss the newest governor when no one exaggerates, and no one when there are none", () => {
    const game = posted(
      3,
      governorOf({ traits: ["diligent"] }),
      governorOf({ traits: ["hoarder"] }),
    );
    const [, newest] = governorsOf(game);
    const empty = posted(3);

    game.illusion.failAudit(contextFor(game));
    empty.illusion.failAudit(contextFor(empty));

    expect(governorsOf(game)).toHaveLength(1);
    expect(game.state.posting.formerStaff[0]?.name).toBe(
      newest?.name as string,
    );
    expect(empty.state.posting.formerStaff).toEqual([]);
  });
});

describe("candidates", () => {
  test("may be offered only after promotion and while governors and waiting candidates leave room under the cap", () => {
    const game = posted(3);
    const beforePromotion = game.governors.canOffer;
    game.state.career.promotedAt = 1;
    addGovernors(
      game,
      ...Array.from({ length: tuning.governors.cap - 1 }, () => governorOf()),
    );
    const withOneSpare = game.governors.canOffer;

    candidateOf(game);

    expect(beforePromotion).toBe(false);
    expect(withOneSpare).toBe(true);
    expect(game.governors.canOffer).toBe(false);
  });

  test("arrive on the desk with drawn details once the village is promoted", () => {
    const game = posted(3);
    game.state.career.promotedAt = 1;
    const seen: Candidate[] = [];

    for (let i = 0; i < 400 && seen.length === 0; i++) {
      game.state.posting.desk.nextArrivalTick = game.state.tick + 1;
      game.state.posting.desk.disputes = [];
      game.steps.step([], quietOptions);
      seen.push(...game.desk.candidates);
    }

    const [candidate] = seen;
    expect(candidate).toBeDefined();
    const { village, price, term } = tuning.governors;
    expect(candidate?.village).toBeGreaterThanOrEqual(village.min);
    expect(candidate?.village).toBeLessThanOrEqual(village.max);
    expect(candidate?.price).toBeGreaterThanOrEqual(price.min);
    expect(candidate?.price).toBeLessThanOrEqual(price.max);
    expect(candidate?.term).toBeGreaterThanOrEqual(term.minTicks);
    expect(candidate?.traits.length).toBeGreaterThanOrEqual(1);
    expect(candidate?.traits.length).toBeLessThanOrEqual(2);
  });

  test("never arrive before promotion", () => {
    const game = posted(3);

    for (let i = 0; i < 400; i++) {
      game.state.posting.desk.nextArrivalTick = game.state.tick + 1;
      game.state.posting.desk.disputes = [];
      game.steps.step([], quietOptions);
      expect(game.desk.candidates).toEqual([]);
    }
  });

  test("take a name no peasant, governor or other candidate holds", () => {
    const game = posted(3, governorOf());
    const [heldByPeasant] = game.delegates.peasants;
    candidateOf(game, { name: "Wat" });
    const taken = new Set([...game.delegates.all.map((d) => d.name), "Wat"]);

    const drawn = Array.from({ length: 20 }, () => game.delegates.findName());

    expect(heldByPeasant).toBeDefined();
    expect(drawn.some((name) => taken.has(name))).toBe(false);
  });
});

describe("hiring through the desk", () => {
  function hire(game: Game, entry: Candidate, option: string) {
    return game.commands.apply(
      { type: "settleDispute", dispute: entry.id, option },
      contextFor(game),
    );
  }

  test("hiring pays the price and puts the candidate on the roster with their details and term", () => {
    const game = posted(3);
    game.state.tick = 100;
    game.state.posting.resources.coin = 200;
    const entry = candidateOf(game, {
      name: "Wat",
      traits: ["skimmer", "braggart"],
    });

    const result = hire(game, entry, "hire");

    const [governor] = governorsOf(game);
    expect(result).toEqual({ ok: true });
    expect(game.state.posting.resources.coin).toBe(200 - entry.price);
    expect(governor).toMatchObject({
      name: "Wat",
      kind: "governor",
      job: entry.job,
      village: entry.village,
      traits: ["skimmer", "braggart"],
      hiredAt: 100,
      termEndsAt: 100 + entry.term,
      hoard: 0,
    });
    expect(game.desk.candidates).toEqual([]);
  });

  test("passing hires no one and costs nothing", () => {
    const game = posted(3);
    game.state.posting.resources.coin = 200;
    const entry = candidateOf(game);

    const result = hire(game, entry, "pass");

    expect(result).toEqual({ ok: true });
    expect(governorsOf(game)).toEqual([]);
    expect(game.state.posting.resources.coin).toBe(200);
    expect(game.desk.candidates).toEqual([]);
  });

  test("a candidate who cannot be paid or who has no room is refused and stays on the desk", () => {
    const poor = posted(3);
    const entry = candidateOf(poor);
    const full = posted(
      3,
      ...Array.from({ length: tuning.governors.cap }, () => governorOf()),
    );
    full.state.posting.resources.coin = 1000;
    const crowded = candidateOf(full);

    expect(hire(poor, entry, "hire").ok).toBe(false);
    expect(hire(full, crowded, "hire").ok).toBe(false);
    expect(poor.desk.candidates).toHaveLength(1);
    expect(full.desk.candidates).toHaveLength(1);
  });

  test("the desk view prices the hire in coin and reads the candidate's details", () => {
    const game = posted(3);
    game.state.posting.resources.coin = 500;
    const entry = candidateOf(game, {
      name: "Wat",
      village: 7,
      price: 90,
      traits: ["hoarder"],
    });

    const [view] = game.view.compute().desk;

    expect(view?.kind).toBe("candidate");
    expect(view?.label).toContain("Wat");
    expect(view?.label).toContain("7");
    expect(view?.label).toContain(copy.governors.traitWords.hoarder);
    expect(view?.options.find((o) => o.id === "hire")?.resources).toEqual({
      coin: -entry.price,
    });
    expect(view?.options.find((o) => o.id === "pass")?.resources).toEqual({});
  });
});
