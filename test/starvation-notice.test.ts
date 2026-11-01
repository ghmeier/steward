import { describe, expect, test } from "bun:test";
import type { GameView } from "../src/core/view";
import { starvationNotice } from "../src/tui/starvation-notice";

const NAMES = ["Ada", "Hob", "Cole", "Dee", "Eli", "Fen", "Gus"];

function viewOf(names: string[], starved: number): GameView {
  return {
    realm: { population: names.length, starved },
    delegates: names.map((name) => ({ id: NAMES.indexOf(name) + 1, name })),
  } as unknown as GameView;
}

describe("starvationNotice", () => {
  test.each([
    ["nobody starved", 0, 0, 0],
    ["a peasant left but the starved count stayed put", 1, 4, 4],
  ])("is null when %s", (_name, gone, before, after) => {
    const next = viewOf(NAMES.slice(gone), after);

    expect(starvationNotice(viewOf(NAMES, before), next)).toBeNull();
  });

  test.each<[string, number, number, string[], number]>([
    ["one death names the peasant", 1, 1, ["Ada"], 0],
    ["two deaths name both", 2, 2, ["Ada", "Hob"], 0],
    ["three deaths name two and count one other", 3, 3, ["Ada", "Hob"], 1],
    ["five deaths name two and count three others", 5, 5, ["Ada", "Hob"], 3],
    ["names no more peasants than the count rose by", 2, 1, ["Ada"], 0],
  ])("%s", (_name, gone, starved, named, others) => {
    const next = viewOf(NAMES.slice(gone), starved);

    const notice = starvationNotice(viewOf(NAMES, 0), next) ?? "";

    for (const name of named) expect(notice).toContain(name);
    for (const name of NAMES.filter((n) => !named.includes(n))) {
      expect(notice).not.toContain(name);
    }
    if (others === 1) {
      expect(notice).toContain("1 other");
      expect(notice).not.toContain("others");
    } else if (others > 1) expect(notice).toContain(`${others} others`);
    else expect(notice).not.toMatch(/\d/);
  });
});
