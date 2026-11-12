import { describe, expect, test } from "bun:test";
import { setRoster, economyTestTuning as tuning } from "../../test/helpers";
import type { Command } from "../core/commands";
import { copy } from "../core/copy";
import type { Candidate } from "../core/desk";
import { Game } from "../core/game";
import { Job } from "../core/realm";
import { courtEntryLabel, courtMenu } from "./court-menu";
import { formatTicks } from "./format";
import {
  type MenuContext,
  type MenuState,
  menuKey,
  openMenu,
  renderMenu,
} from "./menu";

function villageWith(templates: string[], coin = 100): Game {
  const game = Game.create(1, tuning);
  setRoster(game, { idle: 10 });
  const { posting } = game.state;
  posting.resources.coin = coin;
  posting.desk.disputes = templates.map((template, index) => ({
    id: index + 1,
    kind: "dispute" as const,
    template,
    parties: [1, 2],
    arrivedAt: 0,
  }));
  return game;
}

class Walker {
  state: MenuState | null;
  commands: Command[] = [];
  private context: MenuContext;
  constructor(game: Game) {
    this.context = { view: game.view.compute(), tuning };
    this.state = openMenu(courtMenu);
  }
  key(name: string) {
    if (this.state === null) throw new Error("menu closed");
    const step = menuKey(
      this.state,
      { name, ctrl: false, meta: false, shift: false, sequence: name },
      this.context,
    );
    this.state = step.state;
    this.commands.push(...step.commands);
  }
  lines(): string[] {
    return this.state === null
      ? []
      : renderMenu(this.state, this.context).lines;
  }
  moveTo(index: number) {
    for (let i = 0; i < index; i++) this.key("down");
  }
}

describe("court menu", () => {
  test("the root lists the waiting entries in desk order, and with none opens nothing", () => {
    const game = villageWith(["hen", "boundary"]);
    const view = game.view.compute();

    const items = new Walker(game).lines().map((line) => line.slice(2));
    const empty = new Walker(villageWith([]));
    empty.key("return");

    expect(items).toEqual(view.desk.map((entry) => entry.label));
    expect(empty.commands).toEqual([]);
    expect(empty.state?.frames).toHaveLength(1);
  });

  test("choosing an option emits one settleDispute with the dispute and option ids and pops back to the root", () => {
    const walk = new Walker(villageWith(["hen", "boundary"]));
    walk.key("down");
    walk.key("return");

    walk.moveTo(1);
    walk.key("return");

    expect(walk.commands).toEqual([
      { type: "settleDispute", dispute: 2, option: "for-first" },
    ]);
    expect(walk.state?.frames).toHaveLength(1);
  });

  test("a merchant's offer lists its trade, names nobody and settles by the same command", () => {
    const game = villageWith([]);
    game.state.posting.resources.ore = 20;
    game.state.posting.desk.nextDisputeId = 2;
    game.state.posting.desk.disputes = [
      { id: 1, kind: "merchant", template: "ore-buyer", arrivedAt: 0 },
    ];
    const walk = new Walker(game);

    walk.key("return");
    const [sell, decline] = walk.lines().slice(1);
    walk.key("return");

    const [sellOption] = game.view.compute().desk[0]?.options ?? [];
    expect(sell?.slice(2)).toBe(`${sellOption?.label}: +20 coin, −10 ore`);
    expect(decline).toContain(copy.court.free);
    expect(walk.commands).toEqual([
      { type: "settleDispute", dispute: 1, option: "sell" },
    ]);
  });

  test("options show their cost or gain, the default marker and the name of the party who will sulk", () => {
    const game = villageWith(["boundary"]);
    const walk = new Walker(game);
    const second = game.state.posting.delegates[1]?.name as string;

    walk.key("return");

    const [pay, forFirst, forSecond] = walk.lines().slice(1);
    const sulks = copy.court.sulks({ sulker: second });
    expect(pay).toContain("−10 coin");
    expect(pay).toContain(copy.court.defaultIfIgnored);
    expect(pay).not.toContain(sulks);
    expect(forFirst).toContain("+5 grain");
    expect(forFirst).toContain(sulks);
    expect(forFirst).not.toContain(copy.court.defaultIfIgnored);
    expect(forSecond).toContain(copy.court.free);
  });

  test("a fractional cost is shown rounded up to one decimal and a whole cost without a decimal", () => {
    const view = villageWith(["boundary"]).view.compute();
    const [entry] = view.desk;
    if (entry === undefined) throw new Error("no entry on the desk");
    const [pay, forFirst] = entry.options;
    if (pay === undefined || forFirst === undefined)
      throw new Error("no options");
    pay.resources = { coin: -16.967572545464858 };
    forFirst.resources = { ore: -84.83786272732429, grain: -5 };
    const context = { view, tuning };

    const root = openMenu(courtMenu);
    const step = menuKey(
      root,
      {
        name: "return",
        ctrl: false,
        meta: false,
        shift: false,
        sequence: "return",
      },
      context,
    );
    const [first, second] = renderMenu(
      step.state as MenuState,
      context,
    ).lines.slice(1);

    expect(first).toContain("−17.0 coin");
    expect(second).toContain("−84.9 ore, −5 grain");
  });

  test("an option the village cannot afford is disabled and emits nothing", () => {
    const affordable = new Walker(villageWith(["boundary"]));
    affordable.key("return");
    const label = (affordable.lines()[1] ?? "").slice(2);
    const walk = new Walker(villageWith(["boundary"], 0));
    walk.key("return");

    expect(walk.lines()[1]).toBe(`> ${copy.menus.unavailable({ label })}`);
    walk.key("return");

    expect(walk.commands).toEqual([]);
    expect(walk.state?.frames).toHaveLength(2);
  });
});

describe("a candidate on the desk", () => {
  function villageWithCandidate(coin: number) {
    const game = villageWith([], coin);
    const candidate: Candidate = {
      id: 1,
      kind: "candidate",
      template: "recommended",
      arrivedAt: 0,
      name: "Wilhelmina",
      job: Job.MINE,
      village: 9,
      traits: ["braggart", "hoarder"],
      price: 80,
      term: 4000,
    };
    game.state.posting.desk.disputes.push(candidate);
    return { game, candidate };
  }

  test("the offer names the governor, village, job, traits and price once, with hire and decline options", () => {
    const { game, candidate } = villageWithCandidate(100);
    const walk = new Walker(game);

    walk.key("return");
    const lines = walk.lines().join("\n");

    for (const detail of [
      candidate.name,
      String(candidate.village),
      copy.governors.jobWords[candidate.job],
      copy.governors.traitList({ traits: candidate.traits }),
      String(candidate.price),
    ]) {
      expect(lines).toContain(detail);
    }
    expect(lines).toContain(
      `Take on ${candidate.name}: −${candidate.price} coin`,
    );
    expect(lines).toContain(`Thank ${candidate.name} and send them home: free`);
  });

  test("hiring is offered only to a steward who can pay the price", () => {
    const poor = new Walker(villageWithCandidate(10).game);
    const rich = new Walker(villageWithCandidate(100).game);

    poor.key("return");
    rich.key("return");
    poor.key("return");
    rich.key("return");

    expect(poor.commands).toEqual([]);
    expect(rich.commands).toEqual([
      { type: "settleDispute", dispute: 1, option: "hire" },
    ]);
  });
});

describe("courtEntryLabel", () => {
  test("an entry with its own deadline shows the time left and one without shows its bare label", () => {
    const [entry] = villageWith(["hen"]).view.compute().desk;
    if (entry === undefined) throw new Error("no entry on the desk");
    const ticksLeft = 80 * (1000 / tuning.stepMs);

    const timed = courtEntryLabel({ ...entry, ticksLeft }, tuning);
    const untimed = courtEntryLabel({ ...entry, ticksLeft: null }, tuning);

    expect(timed).toBe(
      copy.court.dueIn({
        wait: formatTicks(ticksLeft, tuning.stepMs),
        label: entry.label,
      }),
    );
    expect(untimed).toBe(entry.label);
  });
});
