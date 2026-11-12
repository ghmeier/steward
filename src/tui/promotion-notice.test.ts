import { describe, expect, test } from "bun:test";
import { noticeFrame, viewWith } from "../../test/helpers";
import { copy } from "../core/copy";
import { promotionNotice } from "./promotion-notice";

const promotedAt = (tick: number) =>
  viewWith({
    promotion: { target: 0, promotedAt: tick },
  });

describe("promotionNotice", () => {
  test("promotion is announced on the frame it happens and never for a save that was already promoted", () => {
    const unpromoted = promotedAt(0);
    const promoted = promotedAt(40);

    expect(promotionNotice(unpromoted, promoted, noticeFrame)).toBe(
      copy.notices.promoted,
    );
    expect(promotionNotice(promoted, promoted, noticeFrame)).toBeNull();
    expect(promotionNotice(unpromoted, unpromoted, noticeFrame)).toBeNull();
  });
});
