import { describe, expect, test } from "bun:test";
import { contextFor, setRoster, tuning } from "../../test/helpers";
import type { CommandLogEntry } from "./commands";
import { Game } from "./game";
import { Job } from "./realm";
import { canonicalStringify } from "./serialize";

function villageOf(count: number, tick = 0) {
  const game = Game.create(1, tuning);
  setRoster(game, { idle: count });
  game.state.tick = tick;
  return game;
}

function assign(game: Game, peasant: number, job: Job) {
  return game.commands.apply(
    { type: "assignPeasant", peasant, job },
    contextFor(game),
  );
}

describe("assignPeasant", () => {
  test("moves exactly the named peasant, and can send a worker back to idle", () => {
    const game = villageOf(3);
    const [first, second] = game.state.posting.delegates;

    const sent = assign(game, second?.id ?? -1, Job.FOREST);

    expect(sent).toEqual({ ok: true });
    expect(second?.job).toBe(Job.FOREST);
    expect(first?.job).toBe(Job.IDLE);
    expect(game.delegates.jobCounts().forest).toBe(1);
    expect(game.delegates.jobCounts().idle).toBe(2);

    const recalled = assign(game, second?.id ?? -1, Job.IDLE);

    expect(recalled).toEqual({ ok: true });
    expect(game.delegates.jobCounts().idle).toBe(3);
  });

  test("rejects an unknown peasant and a repeat of the current job, changing nothing", () => {
    const game = villageOf(2);
    const [worker, idler] = game.state.posting.delegates;
    if (worker) worker.job = Job.FARM;
    const before = canonicalStringify(game.state);

    expect(assign(game, 7777, Job.MINE)).toEqual({
      ok: false,
      reason: "no peasant 7777",
    });
    expect(assign(game, worker?.id ?? -1, Job.FARM)).toEqual({
      ok: false,
      reason: `${worker?.name} already works the farm`,
    });
    expect(assign(game, idler?.id ?? -1, Job.IDLE)).toEqual({
      ok: false,
      reason: `${idler?.name} is already idle`,
    });
    expect(canonicalStringify(game.state)).toBe(before);
  });

  test("refuses a grudged peasant a job until the grudge ends, but allows idle", () => {
    const game = villageOf(1, 19);
    const peasant = game.state.posting.delegates[0];
    if (peasant === undefined) throw new Error("no peasant");
    peasant.grudgeUntil = 20;
    peasant.job = Job.FARM;

    const refused = assign(game, peasant.id, Job.MINE);
    const idled = assign(game, peasant.id, Job.IDLE);
    game.state.tick = 20;
    const afterGrudge = assign(game, peasant.id, Job.MINE);

    expect(refused).toEqual({
      ok: false,
      reason: `${peasant.name} holds a grudge and refuses to work`,
    });
    expect(idled).toEqual({ ok: true });
    expect(afterGrudge).toEqual({ ok: true });
  });
});

describe("parseCommand", () => {
  test("keeps an enactDecree payload without judging it, as a copy", () => {
    const { commands } = villageOf(0);
    const decree = { id: 1 };

    const parsed = commands.parseCommand({ type: "enactDecree", decree });

    expect(parsed).toEqual({ type: "enactDecree", decree: { id: 1 } });
    expect(parsed.type === "enactDecree" && parsed.decree).not.toBe(decree);
  });
});

describe("parseCommand rejections", () => {
  test("rejects a missing or non-object decree, an unknown type or key, and a fractional peasant id", () => {
    const { commands } = villageOf(0);
    const invalid = [
      { type: "enactDecree" },
      { type: "enactDecree", decree: [] },
      { type: "saveDecree", name: "a", decree: null },
      { type: "nope" },
      { type: "noop", extra: 1 },
      { type: "assignPeasant", peasant: 1.5, job: Job.FARM },
    ];

    for (const command of invalid) {
      expect(() => commands.parseCommand(command)).toThrow("command");
    }
  });
});

describe("parseCommandLog", () => {
  test("keeps same-tick entries in file order", () => {
    const input: CommandLogEntry[] = [
      { tick: 1, command: { type: "noop" } },
      {
        tick: 3,
        command: { type: "assignPeasant", peasant: 1, job: Job.FARM },
      },
      {
        tick: 3,
        command: { type: "assignPeasant", peasant: 2, job: Job.IDLE },
      },
    ];
    const { commands } = villageOf(0);

    expect(commands.parseCommandLog(input)).toEqual(input);
  });

  test("rejects decreasing ticks, naming the entry", () => {
    const log = [
      { tick: 5, command: { type: "noop" } },
      { tick: 4, command: { type: "noop" } },
    ];
    const { commands } = villageOf(0);

    expect(() => commands.parseCommandLog(log)).toThrow("command log[1].tick");
  });
});
