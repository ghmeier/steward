import { describe, expect, test } from "bun:test";
import { noticeFrame, viewWith } from "../../test/helpers";
import { copy } from "../core/copy";
import { postingMilestoneNotice } from "./posting-notice";

const view = (canEnd: boolean) =>
  viewWith({
    prestige: {
      demandsMet: 6,
      demandsNeeded: 6,
      canEnd,
      ending: "reassignment",
      coinAccepted: false,
      nextName: "Ashford",
    },
  });

describe("postingMilestoneNotice", () => {
  test("is announced on the frame the posting becomes endable and never for a save that already could end", () => {
    const early = view(false);
    const ready = view(true);

    expect(postingMilestoneNotice(early, ready, noticeFrame)).toBe(
      copy.notices.postingMayEnd({ key: "e", met: 6 }),
    );
    expect(postingMilestoneNotice(ready, ready, noticeFrame)).toBeNull();
    expect(postingMilestoneNotice(early, early, noticeFrame)).toBeNull();
  });
});
