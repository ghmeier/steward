import { describe, expect, test } from "bun:test";
import { noticeFrame, viewWith } from "../../test/helpers";
import { CONJURING, type UnlockId } from "../core/unlocks";
import { unlockNotice } from "./unlock-notices";

const viewOwning = (...unlocks: UnlockId[]) => viewWith({ unlocks });

describe("unlockNotice", () => {
  test("conjuring is announced on the frame it is first owned and never for a save that already owned it", () => {
    const before = viewOwning();
    const after = viewOwning(CONJURING);

    expect(unlockNotice(before, after, noticeFrame)).not.toBeNull();
    expect(unlockNotice(after, after, noticeFrame)).toBeNull();
  });
});
