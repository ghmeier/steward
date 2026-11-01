import { describe, expect, test } from "bun:test";
import { contextFor, setRoster, tuning } from "../../test/helpers";
import {
  apply,
  type CommandLogEntry,
  parseCommand,
  parseCommandLog,
} from "./commands";
import { canonicalStringify } from "./serialize";
import { type GameState, GameStateManager } from "./state";

type Job = "farm" | "forest" | "mine" | "idle";

function villageOf(count: number, tick = 0) {
  const m = new GameStateManager(1, tuning);
  setRoster(m.state, { idle: count });
  m.state.tick = tick;
  return m;
}

function assign(state: GameState, peasant: number, job: Job) {
  return apply(
    state,
    { type: "assignPeasant", peasant, job },
    tuning,
    contextFor(state),
  );
}

describe("assignPeasant", () => {
  test("moves exactly the named peasant, and can send a worker back to idle", () => {
    const m = villageOf(3);
    const [first, second] = m.state.posting.delegates;

    const sent = assign(m.state, second?.id ?? -1, "forest");

    expect(sent).toEqual({ ok: true });
    expect(second?.job).toBe("forest");
    expect(first?.job).toBe("idle");
    expect(m.dm.jobCounts().forest).toBe(1);
    expect(m.dm.jobCounts().idle).toBe(2);

    const recalled = assign(m.state, second?.id ?? -1, "idle");

    expect(recalled).toEqual({ ok: true });
    expect(m.dm.jobCounts().idle).toBe(3);
  });

  test("rejects an unknown peasant and a repeat of the current job, changing nothing", () => {
    const m = villageOf(2);
    const [worker, idler] = m.state.posting.delegates;
    if (worker) worker.job = "farm";
    const before = canonicalStringify(m.state);

    expect(assign(m.state, 7777, "mine")).toEqual({
      ok: false,
      reason: "no peasant 7777",
    });
    expect(assign(m.state, worker?.id ?? -1, "farm")).toEqual({
      ok: false,
      reason: `${worker?.name} already works the farm`,
    });
    expect(assign(m.state, idler?.id ?? -1, "idle")).toEqual({
      ok: false,
      reason: `${idler?.name} is already idle`,
    });
    expect(canonicalStringify(m.state)).toBe(before);
  });

  test("refuses a grudged peasant a job until the grudge ends, but allows idle", () => {
    const m = villageOf(1, 19);
    const peasant = m.state.posting.delegates[0];
    if (peasant === undefined) throw new Error("no peasant");
    peasant.grudgeUntil = 20;
    peasant.job = "farm";

    const refused = assign(m.state, peasant.id, "mine");
    const idled = assign(m.state, peasant.id, "idle");
    m.state.tick = 20;
    const afterGrudge = assign(m.state, peasant.id, "mine");

    expect(refused).toEqual({
      ok: false,
      reason: `${peasant.name} refuses to work (grudge)`,
    });
    expect(idled).toEqual({ ok: true });
    expect(afterGrudge).toEqual({ ok: true });
  });
});

describe("parseCommand", () => {
  test("keeps an enactDecree payload without judging it, as a copy", () => {
    const decree = { id: 1 };

    const parsed = parseCommand({ type: "enactDecree", decree });

    expect(parsed).toEqual({ type: "enactDecree", decree: { id: 1 } });
    expect(parsed.type === "enactDecree" && parsed.decree).not.toBe(decree);
  });
});

describe("parseCommandLog", () => {
  test("keeps same-tick entries in file order", () => {
    const input: CommandLogEntry[] = [
      { tick: 1, command: { type: "noop" } },
      { tick: 3, command: { type: "assignPeasant", peasant: 1, job: "farm" } },
      { tick: 3, command: { type: "assignPeasant", peasant: 2, job: "idle" } },
    ];

    expect(parseCommandLog(input)).toEqual(input);
  });

  test("rejects decreasing ticks, naming the entry", () => {
    const log = [
      { tick: 5, command: { type: "noop" } },
      { tick: 4, command: { type: "noop" } },
    ];

    expect(() => parseCommandLog(log)).toThrow("command log[1].tick");
  });
});
