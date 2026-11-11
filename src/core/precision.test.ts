import { describe, expect, test } from "bun:test";
import {
  addGovernors,
  contextFor,
  governorOf,
  grantUnlocks,
  setRoster,
  tuning,
} from "../../test/helpers";
import { stateHash } from "../save/hash";
import { copy } from "./copy";
import type { Decree } from "./decree";
import { Game } from "./game";
import { NO_AUDIT_TICK, ROUGH_DEBT_STEP } from "./illusion";
import { Job } from "./realm";
import { CONJURING, EXACT_DEBT, TRUE_REPORTS } from "./unlocks";

function indebted(grain: number, ...unlocks: string[]): Game {
  const game = Game.create(1, tuning);
  setRoster(game, { idle: tuning.village.promotionPopulation });
  grantUnlocks(game, [CONJURING, ...unlocks]);
  game.state.posting.illusion.debt.grain = grain;
  return game;
}

function debtView(game: Game) {
  const view = game.view.compute().illusion;
  if (view === null) throw new Error("conjuring is not unlocked");
  return view;
}

describe("debt shown on the books", () => {
  test("rounds up to the nearest ten, so a small debt reads as ten and a multiple stays as it is", () => {
    const small = debtView(indebted(0.4)).debt.grain?.owed;
    const between = debtView(indebted(121)).debt.grain?.owed;
    const multiple = debtView(indebted(120)).debt.grain?.owed;
    const none = debtView(indebted(0)).debt.grain?.owed;

    expect(small).toBe(ROUGH_DEBT_STEP);
    expect(between).toBe(130);
    expect(multiple).toBe(120);
    expect(none).toBe(0);
  });

  test("shows the debt to a tenth once exact books are owned, and says which it is showing", () => {
    const rough = debtView(indebted(123.456));
    const exact = debtView(indebted(123.456, EXACT_DEBT));

    expect(exact.debt.grain?.owed).toBe(123.5);
    expect(exact.debtIsExact).toBe(true);
    expect(rough.debtIsExact).toBe(false);
  });

  test("says whether real stock covers the debt and how much of it stock would repay", () => {
    const game = indebted(120);
    game.state.posting.resources.grain = 45;
    const short = debtView(game).debt.grain;
    game.state.posting.resources.grain = 500;
    const covered = debtView(game).debt.grain;

    expect(short).toEqual({ owed: 120, repayable: 50, covered: false });
    expect(covered).toEqual({ owed: 120, repayable: 120, covered: true });
  });
});

describe("audit timing", () => {
  function announced(...unlocks: string[]): Game {
    const game = indebted(0, ...unlocks);
    game.state.posting.illusion.auditAt = game.state.tick + 50;
    return game;
  }

  test("shows ticks until the auditors arrive only with exact books, and always says they are on the road", () => {
    const rough = debtView(announced());
    const exact = debtView(announced(EXACT_DEBT));

    expect(rough.auditInTicks).toBeNull();
    expect(rough.auditOnTheRoad).toBe(true);
    expect(exact.auditInTicks).toBe(50);
  });

  test("shows no timing with exact books when no audit is announced", () => {
    const game = announced(EXACT_DEBT);
    game.state.posting.illusion.auditAt = NO_AUDIT_TICK;

    const view = debtView(game);

    expect(view.auditInTicks).toBeNull();
    expect(view.auditOnTheRoad).toBe(false);
  });
});

describe("governor reports", () => {
  function braggartVillage(...unlocks: string[]): Game {
    const game = Game.create(1, tuning);
    setRoster(game, { idle: 3 });
    addGovernors(
      game,
      governorOf({ village: 10, job: Job.MINE, traits: ["braggart"] }),
    );
    grantUnlocks(game, unlocks);
    return game;
  }
  const perSecond = (perTick: number) => (perTick * 1000) / tuning.stepMs;
  const oreRate = (game: Game) =>
    game.view.compute().ledger.find((line) => line.resource === "ore")
      ?.ratePerSecond as number;

  test("true reports remove the gap from the ledger rate, so it matches what the stores receive", () => {
    const honest = braggartVillage(TRUE_REPORTS);
    const boasting = braggartVillage();
    const before = honest.state.posting.resources.ore ?? 0;

    const displayed = oreRate(honest);
    honest.steps.step([], { absorbed: null, validateEvery: 0 });
    const landed = (honest.state.posting.resources.ore ?? 0) - before;

    expect(displayed).toBeCloseTo(perSecond(landed), 9);
    expect(oreRate(boasting)).toBeGreaterThan(displayed);
  });

  test("true reports fill each governor's real output and the gap, and leave them empty without it", () => {
    const real = 10 * tuning.economy.orePerWorker;
    const reported = real * tuning.governors.traits.braggart.report;

    const [withTruth] = braggartVillage(TRUE_REPORTS).view.compute().governors;
    const [without] = braggartVillage().view.compute().governors;

    expect(withTruth?.truth?.realPerSecond).toBeCloseTo(perSecond(real), 9);
    expect(withTruth?.truth?.gapPerSecond).toBeCloseTo(
      perSecond(reported - real),
      9,
    );
    expect(withTruth?.reportedPerSecond).toBeCloseTo(perSecond(reported), 9);
    expect(without?.truth).toBeNull();
  });
});

describe("the debt decree quantity", () => {
  const decree: Decree = {
    id: "owe",
    petition: "labor",
    rules: [
      {
        when: {
          kind: "compare",
          quantity: "debt",
          comparison: "above",
          value: 5,
        },
        policy: "farming",
      },
    ],
    otherwise: "balanced",
  };
  const exactBooks = tuning.archive.entries.find(
    (entry) => entry.id === EXACT_DEBT,
  );

  test("is refused naming the Archive entry without exact books, and accepted with them", () => {
    const game = Game.create(1, tuning);
    const before = stateHash(game.state);

    expect(() => game.decrees.enact(decree)).toThrow(exactBooks?.label ?? "");
    expect(stateHash(game.state)).toBe(before);

    grantUnlocks(game, [EXACT_DEBT]);
    expect(() => game.decrees.enact(decree)).not.toThrow();
  });
});

describe("repaying with back", () => {
  function back(game: Game) {
    game.state.tick += 1;
    return game.commands.apply(
      { type: "back", resource: "grain" },
      contextFor(game),
    );
  }

  test("reports a full repayment with a rough figure and leaves nothing owed", () => {
    const game = indebted(121);
    game.state.posting.resources.grain = 500;

    const result = back(game);

    expect(result).toEqual({
      ok: true,
      message: copy.illusion.repaidAll({ resource: "grain", repaid: "~130" }),
    });
    expect(game.state.posting.illusion.debt.grain).toBe(0);
  });

  test("reports a partial repayment when the stock falls short, and what is still owed", () => {
    const game = indebted(120);
    game.state.posting.resources.grain = 45;

    const result = back(game);

    expect(result).toEqual({
      ok: true,
      message: copy.illusion.repaidPartly({
        resource: "grain",
        repaid: "~50",
        left: "~80",
      }),
    });
    expect(game.state.posting.illusion.debt.grain).toBe(75);
    expect(game.state.posting.resources.grain).toBe(0);
  });

  test("reports exact figures with exact books", () => {
    const game = indebted(120.25, EXACT_DEBT);
    game.state.posting.resources.grain = 500;

    const result = back(game);

    expect(result).toEqual({
      ok: true,
      message: copy.illusion.repaidAll({ resource: "grain", repaid: "120.3" }),
    });
  });
});
