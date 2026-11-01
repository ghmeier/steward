import { describe, expect, test } from "bun:test";
import { quietOptions, tuning } from "../../test/helpers";
import type { Command } from "../core/commands";
import { Game } from "../core/game";
import { Job } from "../core/realm";
import { stateHash } from "../save/hash";
import { Session } from "./session";

const assignFarmer: Command = {
  type: "assignPeasant",
  peasant: 1,
  job: Job.FARM,
};

function setup(maxStepsPerFrame?: number) {
  let nowMs = 0;
  const game = Game.create(7, tuning);
  const initial = game.clone();
  const session = new Session(game, {
    now: () => nowMs,
    validate: true,
    ...(maxStepsPerFrame === undefined ? {} : { maxStepsPerFrame }),
  });
  session.frame();
  return {
    game,
    initial,
    session,
    advance(ms: number) {
      nowMs += ms;
      return session.frame();
    },
  };
}

describe("session frames", () => {
  test("the first frame runs no step", () => {
    const game = Game.create(7, tuning);
    const session = new Session(game, { now: () => 0 });

    expect(session.frame().steps).toBe(0);
    expect(game.state.tick).toBe(0);
  });

  test.each([
    ["less than a stepMs runs nothing", undefined, tuning.stepMs - 1, 0],
    ["n stepMs runs exactly n steps", undefined, 3 * tuning.stepMs, 3],
    ["a large jump is capped at maxStepsPerFrame", 5, 1000 * tuning.stepMs, 5],
  ])("%s", (_name, cap, elapsed, steps) => {
    const { game, session, advance } = setup(cap);
    const before = session.view();

    const result = advance(elapsed);

    expect(result.steps).toBe(steps);
    expect(game.state.tick).toBe(steps);
    expect(result.viewChanged).toBe(steps > 0);
    if (steps === 0) expect(session.view()).toBe(before);
  });
});

describe("session commands", () => {
  test("a command waits for a stepping frame, applies in its first step only, and is logged with that tick", () => {
    const { game, session, advance } = setup();
    const farmers = () => game.delegates.jobCounts().farm;
    const before = farmers();

    session.enqueue(assignFarmer);
    advance(1);
    expect(farmers()).toBe(before);
    expect(session.commandLog).toEqual([]);
    const result = advance(3 * tuning.stepMs);

    expect(farmers()).toBe(before + 1);
    expect(result.rejections).toEqual([]);
    expect(session.commandLog).toEqual([{ tick: 1, command: assignFarmer }]);
    expect(session.view().tick).toBe(game.state.tick);
  });

  test("a rejected command is reported with its tick and reason and still logged", () => {
    const { session, advance } = setup();
    const missingMiner: Command = {
      type: "assignPeasant",
      peasant: 9999,
      job: Job.MINE,
    };

    session.enqueue(missingMiner);
    const result = advance(tuning.stepMs);

    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0]).toMatchObject({
      tick: 1,
      command: missingMiner,
    });
    expect(result.rejections[0]?.reason).toContain("no peasant 9999");
    expect(session.commandLog).toEqual([{ tick: 1, command: missingMiner }]);
  });
});

describe("session replay", () => {
  test("replaying the command log on a fresh clone reproduces the live state hash", () => {
    const { game, initial, session, advance } = setup();
    const script: [number, Command | null][] = [
      [tuning.stepMs, { type: "assignPeasant", peasant: 1, job: Job.FARM }],
      [7 * tuning.stepMs, null],
      [tuning.stepMs / 2, { type: "assignPeasant", peasant: 2, job: Job.IDLE }],
      [tuning.stepMs, { type: "assignPeasant", peasant: 3, job: Job.FOREST }],
      [
        40 * tuning.stepMs,
        { type: "assignPeasant", peasant: 1, job: Job.IDLE },
      ],
      [3 * tuning.stepMs, null],
    ];

    for (const [ms, command] of script) {
      if (command) session.enqueue(command);
      advance(ms);
    }
    initial.steps.runSteps(game.state.tick, session.commandLog, quietOptions);

    expect(game.state.tick).toBeGreaterThan(40);
    expect(session.commandLog.length).toBe(4);
    expect(stateHash(initial.state)).toBe(stateHash(game.state));
  });
});
