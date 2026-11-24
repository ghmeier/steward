import { describe, expect, test } from "bun:test";
import {
  addGovernors,
  contextFor,
  governorOf,
  grantUnlocks,
  quietOptions,
  setRoster,
  tuning,
} from "../../test/helpers";
import type { Governor } from "./delegates";
import { Game } from "./game";
import { CROWN_PANEL } from "./unlocks";

const { loyalty: rules, term } = tuning.governors;
const { ticksPerSeason } = tuning.economy;

function posted(...governors: Governor[]): Game {
  const game = Game.create(1, tuning);
  setRoster(game, { idle: 3 });
  addGovernors(game, ...governors);
  return game;
}

function loyaltyOf(game: Game): number[] {
  return game.delegates.governors.map(({ loyalty }) => loyalty);
}

function milestoneGame(...governors: Governor[]): Game {
  const game = posted(...governors);
  game.state.tick = 5000;
  grantUnlocks(game, [CROWN_PANEL]);
  game.state.posting.crown.met = tuning.prestige.demandsMet;
  return game;
}

function endPosting(game: Game): void {
  game.steps.step([{ type: "endPosting", name: "Greywater" }], quietOptions);
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

  test("a governor who serves through a backed audit gains loyalty and one who is dismissed in a failed audit does not", () => {
    const backed = posted(governorOf({ loyalty: 2 }));
    const failed = posted(governorOf({ loyalty: 2 }));
    failed.state.posting.illusion.debt.coin = 10;

    backed.illusion.settleAudit("back", contextFor(backed));
    failed.illusion.failAudit(contextFor(failed));

    expect(loyaltyOf(backed)).toEqual([2 + rules.backedAudit]);
    expect(failed.state.posting.formerStaff[0]?.loyalty).toBe(rules.seized);
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

  test("a governor who retires keeps their loyalty in the record of former staff", () => {
    const game = posted(governorOf({ loyalty: 4, termEndsAt: 1 }));

    game.steps.runSteps(1, [], quietOptions);

    expect(game.state.posting.formerStaff[0]).toMatchObject({
      reason: "retired",
      loyalty: 4,
    });
  });
});

describe("who follows", () => {
  test("only governors at or above the threshold follow, and the cap limits how many", () => {
    const game = milestoneGame(
      governorOf({ loyalty: rules.followAt - 1 }),
      governorOf({ loyalty: rules.followAt }),
      governorOf({ loyalty: rules.followAt + 1 }),
      governorOf({ loyalty: rules.followAt + 2 }),
    );
    const [, , , top] = game.delegates.governors;

    const followers = game.governors.chooseFollowers();

    expect(followers).toHaveLength(rules.followerCap);
    expect(followers[0]?.name).toBe(top?.name as string);
    expect(followers.every(({ loyalty }) => loyalty >= rules.followAt)).toBe(
      true,
    );
  });

  test("nobody follows when no governor reaches the threshold", () => {
    const game = milestoneGame(governorOf({ loyalty: rules.followAt - 1 }));

    expect(game.governors.chooseFollowers()).toEqual([]);
  });

  test("equal loyalty goes to the longest-serving governor, then the lower id", () => {
    const game = milestoneGame(
      governorOf({ loyalty: rules.followAt, hiredAt: 300 }),
      governorOf({ loyalty: rules.followAt, hiredAt: 100 }),
      governorOf({ loyalty: rules.followAt, hiredAt: 100 }),
    );
    const [late, firstOfTwo] = game.delegates.governors;

    const names = game.governors.chooseFollowers().map(({ name }) => name);

    expect(names).toEqual([
      firstOfTwo?.name as string,
      game.delegates.governors[2]?.name as string,
    ]);
    expect(names).not.toContain(late?.name as string);
  });
});

describe("arriving in the next posting", () => {
  function followersAfterEnding() {
    const game = milestoneGame(
      governorOf({ loyalty: rules.followAt, traits: ["diligent"] }),
      governorOf({ loyalty: rules.followAt - 1 }),
    );
    const [loyal, wary] = game.delegates.governors;
    endPosting(game);
    return { game, loyal: loyal as Governor, wary: wary as Governor };
  }

  test("a follower is seated as a governor with a new id, a fresh term and a village", () => {
    const { game, loyal } = followersAfterEnding();

    const [seated, ...others] = game.delegates.governors;

    expect(others).toEqual([]);
    expect(seated).toMatchObject({
      name: loyal.name,
      traits: loyal.traits,
      loyalty: loyal.loyalty,
      hiredAt: game.state.tick,
      hoard: 0,
    });
    expect(seated?.id).toBeGreaterThan(tuning.prestige.population);
    expect(seated?.id).toBeLessThan(game.state.posting.nextDelegateId);
    expect(seated?.village).toBeGreaterThanOrEqual(
      tuning.governors.village.min,
    );
    expect(
      (seated?.termEndsAt as number) - game.state.tick,
    ).toBeGreaterThanOrEqual(term.minTicks);
    expect(() => game.validate()).not.toThrow();
  });

  test("a governor below the threshold is left behind and the career records who followed", () => {
    const { game, loyal, wary } = followersAfterEnding();

    const names = game.delegates.all.map(({ name }) => name);

    expect(names).not.toContain(wary.name);
    expect(game.state.career.followers.map(({ name }) => name)).toEqual([
      loyal.name,
    ]);
  });

  test("no peasant or candidate takes a follower's name, however the names are drawn", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const game = milestoneGame(governorOf({ loyalty: rules.followAt }));
      game.state.posting.seed = seed;
      const [loyal] = game.delegates.governors;
      endPosting(game);

      const names = game.delegates.all.map(({ name }) => name);
      expect(names.filter((name) => name === loyal?.name)).toHaveLength(1);
      expect(new Set(names).size).toBe(names.length);
    }
  });
});
