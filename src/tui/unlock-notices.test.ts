import { describe, expect, test } from "bun:test";
import { tuning } from "../../test/helpers";
import { CONJURING } from "../core/unlocks";
import { announceNewUnlocks, CONJURING_OPENS } from "./unlock-notices";

describe("announceNewUnlocks", () => {
  test("conjuring is announced once when it is first owned and never for a save that already owned it", () => {
    const known = new Set<string>();
    const loaded = new Set([CONJURING]);

    const first = announceNewUnlocks(known, [CONJURING], tuning);
    const again = announceNewUnlocks(known, [CONJURING], tuning);
    const reload = announceNewUnlocks(loaded, [CONJURING], tuning);

    expect(first).toBe(CONJURING_OPENS);
    expect(again).toBeNull();
    expect(reload).toBeNull();
  });
});
