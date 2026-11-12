import { describe, expect, test } from "bun:test";
import {
  addGovernors,
  contextFor,
  governorOf,
  noticeFrame,
  quietOptions,
  setRoster,
  tuning,
} from "../../test/helpers";
import { copy } from "../core/copy";
import { Game } from "../core/game";
import { Job } from "../core/realm";
import { formatAmount } from "./format";
import { governorNotice } from "./governor-notices";

function village(...governors: Parameters<typeof governorOf>[0][]): Game {
  const game = Game.create(1, tuning);
  setRoster(game, { idle: 3 });
  addGovernors(game, ...governors.map((fields) => governorOf(fields)));
  return game;
}

function stepTo(game: Game, tick: number): void {
  while (game.state.tick < tick) game.steps.step([], quietOptions);
}

describe("governorNotice", () => {
  test("a retirement is reported on the frame it happens and never again", () => {
    const game = village({ termEndsAt: 2 });
    const [governor] = game.delegates.governors;
    const before = game.view.compute();
    stepTo(game, 2);

    const after = game.view.compute();
    stepTo(game, 3);

    expect(governorNotice(before, after, noticeFrame)).toBe(
      copy.notices.governorRetired({ name: governor?.name as string }),
    );
    expect(governorNotice(after, game.view.compute(), noticeFrame)).toBeNull();
    expect(governorNotice(before, before, noticeFrame)).toBeNull();
  });

  test("a death is reported with the governor's name and the cause of death", () => {
    const game = Game.fromState(structuredClone(village({}).state), {
      ...tuning,
      governors: { ...tuning.governors, deathPerMille: 1000 },
    });
    const [governor] = game.delegates.governors;
    const before = game.view.compute();

    stepTo(game, tuning.economy.ticksPerSeason);

    const cause = game.state.posting.formerStaff[0]?.cause as string;
    expect(tuning.governors.causes).toContain(cause);
    expect(governorNotice(before, game.view.compute(), noticeFrame)).toBe(
      copy.notices.governorDied({ name: governor?.name as string, cause }),
    );
  });

  test("a dismissal after a failed audit names the governor who was blamed", () => {
    const game = village({ traits: ["braggart"] }, { traits: ["diligent"] });
    const [braggart] = game.delegates.governors;
    const before = game.view.compute();

    game.illusion.failAudit(contextFor(game));

    expect(governorNotice(before, game.view.compute(), noticeFrame)).toBe(
      copy.notices.governorDismissed({ name: braggart?.name as string }),
    );
  });

  test("a hoard handed over is reported with its size, and a governor with none adds no mention", () => {
    const hoarding = village({ job: Job.IDLE, hoard: 50, termEndsAt: 1 });
    const honest = village({ job: Job.IDLE, termEndsAt: 1 });
    const beforeHoarding = hoarding.view.compute();
    const beforeHonest = honest.view.compute();

    stepTo(hoarding, 1);
    stepTo(honest, 1);

    expect(
      governorNotice(beforeHoarding, hoarding.view.compute(), noticeFrame),
    ).toContain(copy.notices.governorHandedOver({ coin: formatAmount(50) }));
    expect(
      governorNotice(beforeHonest, honest.view.compute(), noticeFrame),
    ).not.toContain(copy.notices.governorHandedOver({ coin: formatAmount(0) }));
  });

  test("a loaded save whose first view already lists former governors replays nothing", () => {
    const game = village({ termEndsAt: 1 });
    stepTo(game, 1);
    const loaded = game.view.compute();

    expect(governorNotice(loaded, game.view.compute(), noticeFrame)).toBeNull();
  });
});
