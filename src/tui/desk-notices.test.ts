import { describe, expect, test } from "bun:test";
import { tuning } from "../../test/helpers";
import { Game } from "../core/game";
import type { GameView } from "../core/view";
import { deskNotice } from "./desk-notices";

function viewOf(game: Game): GameView {
  return game.view.compute();
}

function game() {
  const created = Game.create(1, tuning);
  created.state.posting.desk.nextDisputeId = 8;
  return created;
}

describe("desk notice", () => {
  test("an arrival posts the entry's first line", () => {
    const before = game();
    const after = before.clone();
    after.state.posting.desk.disputes = [
      { id: 7, kind: "merchant", template: "smith", arrivedAt: 1 },
    ];

    const notice = deskNotice(viewOf(before), viewOf(after));

    expect(notice).toBe(viewOf(after).desk[0]?.label as string);
  });

  test("an expiry posts its flavor line once", () => {
    const before = game();
    const after = before.clone();
    after.state.posting.desk.lastExpired = {
      id: 7,
      line: "The smith moved on.",
    };

    const first = deskNotice(viewOf(before), viewOf(after));
    const repeat = deskNotice(viewOf(after), viewOf(after));

    expect(first).toBe("The smith moved on.");
    expect(repeat).toBeNull();
  });

  test("an entry that is still waiting, or one the player settled, posts nothing", () => {
    const before = game();
    before.state.posting.desk.disputes = [
      { id: 7, kind: "traveller", template: "stranger", arrivedAt: 1 },
    ];
    const settled = before.clone();
    settled.state.posting.desk.disputes = [];

    expect(deskNotice(viewOf(before), viewOf(before))).toBeNull();
    expect(deskNotice(viewOf(before), viewOf(settled))).toBeNull();
  });

  test("an expiry and an arrival in one frame post both, the expiry first", () => {
    const before = game();
    const after = before.clone();
    after.state.posting.desk.lastExpired = { id: 6, line: "Gone." };
    after.state.posting.desk.disputes = [
      { id: 7, kind: "traveller", template: "stranger", arrivedAt: 1 },
    ];

    const notice = deskNotice(viewOf(before), viewOf(after));

    expect(notice).toBe(`Gone. ${viewOf(after).desk[0]?.label}`);
  });
});
