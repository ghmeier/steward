import { describe, expect, test } from "bun:test";
import { noticeFrame, tuning } from "../../test/helpers";
import { Game } from "../core/game";
import { deskNotice } from "./desk-notices";

function game(): Game {
  const created = Game.create(1, tuning);
  created.state.posting.desk.nextDisputeId = 8;
  return created;
}

const expiring = (...expired: string[]) => ({ ...noticeFrame, expired });

describe("desk notice", () => {
  test("a frame posts its expiry lines, then the first line of each arrival", () => {
    const before = game();
    const after = before.clone();
    after.state.posting.desk.disputes = [
      { id: 7, kind: "merchant", template: "smith", arrivedAt: 1 },
    ];
    const [previous, next] = [before.view.compute(), after.view.compute()];
    const arrival = next.desk[0]?.label as string;

    expect(deskNotice(previous, next, noticeFrame)).toBe(arrival);
    expect(deskNotice(previous, previous, expiring("Gone."))).toBe("Gone.");
    expect(deskNotice(previous, next, expiring("Gone.", "Moved on."))).toBe(
      `Gone. Moved on. ${arrival}`,
    );
  });

  test("an entry that is still waiting, or one the player settled, posts nothing", () => {
    const before = game();
    before.state.posting.desk.disputes = [
      { id: 7, kind: "traveller", template: "stranger", arrivedAt: 1 },
    ];
    const settled = before.clone();
    settled.state.posting.desk.disputes = [];
    const waiting = before.view.compute();

    expect(deskNotice(waiting, waiting, noticeFrame)).toBeNull();
    expect(deskNotice(waiting, settled.view.compute(), noticeFrame)).toBeNull();
  });
});
