import { describe, expect, test } from "bun:test";
import { tuning } from "../../test/helpers";
import {
  disposeDrawnPanels,
  dispute,
  drawPanels,
  emptyView,
  key,
} from "../../test/tui-helpers";
import { copy } from "../core/copy";
import { formatTicks } from "./format";
import { Village } from "./village-panels";

disposeDrawnPanels();

describe("the Court panel", () => {
  test("the desk shows a placeholder when it has nothing", async () => {
    const frame = await drawPanels([emptyView()], {
      size: { width: 240, height: 30 },
    });

    expect(frame).toContain(copy.court.deskClear);
  });

  describe("an entry with a deadline of its own", () => {
    const ticksLeft = 80 * (1000 / tuning.stepMs);

    test("shows its time left in Court and an entry without one shows none", async () => {
      const timed = { ...dispute, id: 2, label: "Counted.", ticksLeft };

      const withDeadline = await drawPanels([emptyView({ desk: [timed] })]);
      const without = await drawPanels([emptyView({ desk: [dispute] })]);

      const wait = formatTicks(ticksLeft, tuning.stepMs);
      expect(withDeadline).toContain(
        copy.court.dueIn({ wait, label: timed.label }),
      );
      expect(without).toContain(dispute.label);
      expect(without).not.toContain(
        copy.court.dueIn({ wait, label: dispute.label }),
      );
    });
  });

  test("an entry without parties shows its label like any other", async () => {
    const merchant = {
      id: 2,
      kind: "merchant" as const,
      label: "A smith wants ore",
      parties: null,
      ticksLeft: null,
      options: [],
    };
    const view = emptyView({ desk: [merchant] });

    const frame = await drawPanels([view]);

    expect(frame).toContain("A smith wants ore");
    expect(frame).not.toContain(copy.court.deskClear);
  });

  describe("keys", () => {
    test("escape from the court list gives up focus and a key the list does not use falls through", () => {
      const context = { view: emptyView({ desk: [dispute] }), tuning };
      const panel = new Village().focusable.court;
      panel.enter(context);

      expect(panel.key(key("z"), context)).toBeNull();
      expect(panel.key(key("escape"), context)?.requests).toEqual([
        { kind: "unfocus" },
      ]);
    });
  });
});
