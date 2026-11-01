import { describe, expect, test } from "bun:test";
import {
  apply,
  type CommandLogEntry,
  parseCommand,
  parseCommandLog,
} from "../src/core/commands";
import { idleCount, laborCounts } from "../src/core/delegates";
import { canonicalStringify } from "../src/core/serialize";
import { createNewGame } from "../src/core/state";
import { contextFor, setRoster, tuning } from "./helpers";

type Job = "farm" | "forest" | "mine" | "idle";

function villageOf(count: number, tick = 0) {
  const state = createNewGame(1, tuning);
  setRoster(state, { idle: count });
  state.tick = tick;
  return state;
}

function assign(
  state: ReturnType<typeof villageOf>,
  peasant: number,
  job: Job,
) {
  return apply(
    state,
    { type: "assignPeasant", peasant, job },
    tuning,
    contextFor(state),
  );
}

describe("assignPeasant", () => {
  test("moves exactly the named peasant, and can send a worker back to idle", () => {
    const state = villageOf(3);
    const [first, second] = state.posting.delegates;

    const sent = assign(state, second?.id ?? -1, "forest");

    expect(sent).toEqual({ ok: true });
    expect(second?.job).toBe("forest");
    expect(first?.job).toBe("idle");
    expect(laborCounts(state.posting.delegates).forest).toBe(1);
    expect(idleCount(state.posting.delegates)).toBe(2);

    const recalled = assign(state, second?.id ?? -1, "idle");

    expect(recalled).toEqual({ ok: true });
    expect(idleCount(state.posting.delegates)).toBe(3);
  });

  test("rejects an unknown peasant and a repeat of the current job, changing nothing", () => {
    const state = villageOf(2);
    const [worker, idler] = state.posting.delegates;
    if (worker) worker.job = "farm";
    const before = canonicalStringify(state);

    expect(assign(state, 7777, "mine")).toEqual({
      ok: false,
      reason: "no peasant 7777",
    });
    expect(assign(state, worker?.id ?? -1, "farm")).toEqual({
      ok: false,
      reason: `${worker?.name} already works the farm`,
    });
    expect(assign(state, idler?.id ?? -1, "idle")).toEqual({
      ok: false,
      reason: `${idler?.name} is already idle`,
    });
    expect(canonicalStringify(state)).toBe(before);
  });

  test("refuses a grudged peasant a job until the grudge ends, but allows idle", () => {
    const state = villageOf(1, 19);
    const peasant = state.posting.delegates[0];
    if (peasant === undefined) throw new Error("no peasant");
    peasant.grudgeUntil = 20;
    peasant.job = "farm";

    const refused = assign(state, peasant.id, "mine");
    const idled = assign(state, peasant.id, "idle");
    state.tick = 20;
    const afterGrudge = assign(state, peasant.id, "mine");

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
