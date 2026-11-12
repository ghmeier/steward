import { describe, expect, test } from "bun:test";
import { noticeFrame } from "../../test/helpers";
import { copy } from "../core/copy";
import type { GameView } from "../core/view";
import { starvationNotice } from "./starvation-notice";

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

    expect(
      starvationNotice(viewOf(NAMES, before), next, noticeFrame),
    ).toBeNull();
  });

  test.each<[string, number, number, string[]]>([
    ["names the peasant who starved", 1, 1, ["Ada"]],
    ["names every peasant when two starved", 2, 2, ["Ada", "Hob"]],
    ["names the first two when more starved", 5, 5, ["Ada", "Hob", "Cole"]],
    ["names no more peasants than the count rose by", 2, 1, ["Ada"]],
  ])("reports starvation that %s", (_name, gone, starved, named) => {
    const next = viewOf(NAMES.slice(gone), starved);

    const notice = starvationNotice(viewOf(NAMES, 0), next, noticeFrame);

    expect(notice).toBe(
      copy.notices.starved({ names: named, deaths: starved }),
    );
  });
});
