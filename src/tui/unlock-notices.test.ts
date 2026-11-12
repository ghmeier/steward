import { describe, expect, test } from "bun:test";
import { noticeFrame, viewWith } from "../../test/helpers";
import { copy } from "../core/copy";
import {
  CONJURING,
  COURT_PANEL,
  CROWN_PANEL,
  FORGING,
  GOVERNORS,
  type UnlockId,
} from "../core/unlocks";
import { unlockNotice } from "./unlock-notices";

const viewOwning = (...unlocks: UnlockId[]) => viewWith({ unlocks });

describe("unlockNotice", () => {
  test("conjuring is announced on the frame it is first owned and never for a save that already owned it", () => {
    const before = viewOwning();
    const after = viewOwning(CONJURING);

    expect(unlockNotice(before, after, noticeFrame)).not.toBeNull();
    expect(unlockNotice(after, after, noticeFrame)).toBeNull();
  });

  test.each([
    ["the Court", COURT_PANEL],
    ["the Crown charter", CROWN_PANEL],
    ["forging", FORGING],
    ["governors", GOVERNORS],
  ])(
    "buying %s is announced with its own notice rather than a generic one",
    (_name, id) => {
      const notice = unlockNotice(viewOwning(), viewOwning(id), noticeFrame);

      expect(notice).not.toBeNull();
      expect(notice).not.toBe(copy.notices.unlocked({ label: id }));
    },
  );
});
