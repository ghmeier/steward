import { describe, expect, test } from "bun:test";
import { noticeFrame } from "../../test/helpers";
import { CONJURING } from "../core/unlocks";
import type { GameView } from "../core/view";
import { unlockNotice } from "./unlock-notices";

const viewOwning = (...unlocks: string[]) =>
  ({ unlocks }) as unknown as GameView;

describe("unlockNotice", () => {
  test("conjuring is announced on the frame it is first owned and never for a save that already owned it", () => {
    const before = viewOwning();
    const after = viewOwning(CONJURING);

    expect(unlockNotice(before, after, noticeFrame)).not.toBeNull();
    expect(unlockNotice(after, after, noticeFrame)).toBeNull();
  });
});
