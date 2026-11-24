import { describe, expect, test } from "bun:test";
import {
  addGovernors,
  contextFor,
  endPosting,
  governorOf,
  quietOptions,
  servedVillage,
  setRoster,
  tuning,
} from "../../test/helpers";
import type { Governor } from "./delegates";
import { Game } from "./game";

const { loyalty: rules, term } = tuning.governors;
const { ticksPerSeason } = tuning.economy;

function posted(...governors: Governor[]): Game {
  const game = Game.create(1, tuning);
  setRoster(game, { idle: 3 });
  addGovernors(game, ...governors);
  return game;
}

function servedWith(...governors: Governor[]): Game {
  const game = servedVillage();
  setRoster(game, { idle: 3 });
  addGovernors(game, ...governors);
  return game;
}

function loyaltyOf(game: Game): number[] {
  return game.delegates.governors.map(({ loyalty }) => loyalty);
}

describe("loyalty", () => {
  test("a governor gains loyalty when a season ends and not between seasons", () => {
    const game = posted(governorOf());
    game.state.tick = ticksPerSeason - 2;

    game.steps.runSteps(1, [], quietOptions);
    const midSeason = loyaltyOf(game);
    game.steps.runSteps(1, [], quietOptions);

    expect(midSeason).toEqual([0]);
    expect(loyaltyOf(game)).toEqual([rules.perSeason]);
  });

  test("a governor who serves through a backed audit gains loyalty", () => {
    const game = posted(governorOf({ loyalty: 2 }));

    game.illusion.settleAudit("back", contextFor(game));

    expect(loyaltyOf(game)).toEqual([2 + rules.backedAudit]);
  });

  test("a missed crown demand costs every serving governor loyalty, never below nothing", () => {
    const game = posted(
      governorOf({ loyalty: rules.missedDemand + 4 }),
      governorOf({ loyalty: 1 }),
    );
    game.state.posting.crown.demand = {
      id: 1,
      resource: "ore",
      amount: 50,
      delivered: 0,
      issuedAt: 0,
      dueAt: 1,
    };
    game.state.posting.resources.ore = 0;

    game.steps.runSteps(1, [], quietOptions);

    expect(loyaltyOf(game)).toEqual([4, 0]);
  });

  test("a retired governor keeps their loyalty in the record of former staff and a dismissed one leaves with none", () => {
    const retiring = posted(governorOf({ loyalty: 4, termEndsAt: 1 }));
    const dismissed = posted(governorOf({ loyalty: 4 }));
    dismissed.state.posting.illusion.debt.coin = 10;

    retiring.steps.runSteps(1, [], quietOptions);
    dismissed.illusion.failAudit(contextFor(dismissed));

    expect(retiring.state.posting.formerStaff[0]).toMatchObject({
      reason: "retired",
      loyalty: 4,
    });
    expect(dismissed.state.posting.formerStaff[0]).toMatchObject({
      reason: "dismissed",
      loyalty: 0,
    });
  });
});

describe("who follows", () => {
  test("only governors at or above the threshold follow, up to the cap, and nobody follows when none reaches it", () => {
    const crowded = servedWith(
      governorOf({ loyalty: rules.followAt - 1 }),
      governorOf({ loyalty: rules.followAt }),
      governorOf({ loyalty: rules.followAt + 1 }),
      governorOf({ loyalty: rules.followAt + 2 }),
    );
    const [, , second, top] = crowded.delegates.governors;
    const unready = servedWith(governorOf({ loyalty: rules.followAt - 1 }));

    const followers = crowded.governors.chooseFollowers();

    expect(followers.map(({ name }) => name)).toEqual([
      top?.name as string,
      second?.name as string,
    ]);
    expect(followers).toHaveLength(rules.followerCap);
    expect(unready.governors.chooseFollowers()).toEqual([]);
  });

  test("equal loyalty goes to the longest-serving governor, then the lower id", () => {
    const game = servedWith(
      governorOf({ loyalty: rules.followAt, hiredAt: 300 }),
      governorOf({ loyalty: rules.followAt, hiredAt: 100 }),
      governorOf({ loyalty: rules.followAt, hiredAt: 100 }),
    );
    const [late, first, second] = game.delegates.governors;

    const names = game.governors.chooseFollowers().map(({ name }) => name);

    expect(names).toEqual([first?.name as string, second?.name as string]);
    expect(names).not.toContain(late?.name as string);
  });
});

describe("arriving in the next posting", () => {
  test("a follower is seated with their traits and loyalty and a fresh term, and a governor below the threshold is left behind", () => {
    const game = servedWith(
      governorOf({ loyalty: rules.followAt, traits: ["diligent"] }),
      governorOf({ loyalty: rules.followAt - 1 }),
    );
    const [loyal] = game.delegates.governors as [Governor, Governor];

    endPosting(game);

    const [seated, ...others] = game.delegates.governors;
    expect(others).toEqual([]);
    expect(seated).toMatchObject({
      name: loyal.name,
      traits: loyal.traits,
      loyalty: loyal.loyalty,
      hiredAt: game.state.tick,
      hoard: 0,
    });
    expect(
      (seated?.termEndsAt as number) - game.state.tick,
    ).toBeGreaterThanOrEqual(term.minTicks);
    expect(game.state.career.followers.map(({ name }) => name)).toEqual([
      loyal.name,
    ]);
    expect(() => game.validate()).not.toThrow();
  });

  test("no peasant takes a follower's name, however the names are drawn", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const game = servedWith(governorOf({ loyalty: rules.followAt }));
      game.state.posting.seed = seed;

      endPosting(game);

      const names = game.delegates.all.map(({ name }) => name);
      expect(new Set(names).size).toBe(names.length);
    }
  });
});
