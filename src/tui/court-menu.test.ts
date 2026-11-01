import { describe, expect, test } from "bun:test";
import { setRoster, economyTestTuning as tuning } from "../../test/helpers";
import type { Command } from "../core/commands";
import { createNewGame, type GameState } from "../core/state";
import { computeView } from "../core/view";
import { courtMenu } from "./court-menu";
import {
  type MenuContext,
  type MenuState,
  menuKey,
  openMenu,
  renderMenu,
} from "./menu";

function villageWith(templates: string[], coin = 100): GameState {
  const state = createNewGame(1, tuning);
  setRoster(state, { idle: 10 });
  state.posting.resources.coin = coin;
  state.posting.desk.disputes = templates.map((template, index) => ({
    id: index + 1,
    template,
    parties: [1, 2],
    arrivedAt: 0,
  }));
  return state;
}

class Walker {
  state: MenuState | null;
  commands: Command[] = [];
  private context: MenuContext;
  constructor(state: GameState) {
    this.context = { view: computeView(state, tuning), tuning };
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
  test("the root lists the waiting disputes in desk order, and with none opens nothing", () => {
    const state = villageWith(["hen", "boundary"]);
    const view = computeView(state, tuning);

    const items = new Walker(state).lines().map((line) => line.slice(2));
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

  test("options show their cost or gain, the default marker and the name of the party who will sulk", () => {
    const state = villageWith(["boundary"]);
    const walk = new Walker(state);
    const second = state.posting.delegates[1]?.name as string;

    walk.key("return");

    const [pay, forFirst, forSecond] = walk.lines().slice(1);
    expect(pay).toContain("−10 coin");
    expect(pay).toContain("default");
    expect(pay).not.toContain(second);
    expect(forFirst).toContain("+5 grain");
    expect(forFirst).toContain(second);
    expect(forFirst).not.toContain("default");
    expect(forSecond).toContain("free");
  });

  test("an option the village cannot afford is disabled and emits nothing", () => {
    const walk = new Walker(villageWith(["boundary"], 0));
    walk.key("return");

    expect(walk.lines()[1]).toContain("unavailable");
    walk.key("return");

    expect(walk.commands).toEqual([]);
    expect(walk.state?.frames).toHaveLength(2);
  });
});
