import { describe, expect, test } from "bun:test";
import { noticeFrame, tuning } from "../../test/helpers";
import { copy } from "../core/copy";
import { Game } from "../core/game";
import { CONJURING } from "../core/unlocks";
import type { GameView } from "../core/view";
import { latestNotice } from "./notices";
import { unlockNotice } from "./unlock-notices";

describe("latestNotice", () => {
  test("when several notices speak in one frame, the last in priority order wins", () => {
    const before = Game.create(1, tuning).view.compute();
    const unlocked: GameView = { ...before, unlocks: [CONJURING] };
    const promoted: GameView = {
      ...unlocked,
      promotion: { ...before.promotion, promotedAt: 40 },
    };

    expect(latestNotice(before, unlocked, noticeFrame)).toBe(
      unlockNotice(before, unlocked, noticeFrame),
    );
    expect(latestNotice(before, promoted, noticeFrame)).toBe(
      copy.notices.promoted,
    );
    expect(latestNotice(before, before, noticeFrame)).toBeNull();
  });
});
