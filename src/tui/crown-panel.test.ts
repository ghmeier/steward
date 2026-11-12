import { describe, expect, test } from "bun:test";
import { tuning } from "../../test/helpers";
import {
  disposeDrawnPanels,
  drawPanels,
  emptyView,
  key,
} from "../../test/tui-helpers";
import { copy } from "../core/copy";
import { CROWN_PANEL } from "../core/unlocks";
import type { GameView } from "../core/view";
import { formatTicks, formatTicksRoughly } from "./format";
import { keymap, Village } from "./village-panels";

disposeDrawnPanels();

describe("the Crown panel", () => {
  describe("the herald and demand lines", () => {
    const demand = {
      resource: "ore" as const,
      amount: 80,
      delivered: 45,
      ticksLeft: 80 * (1000 / tuning.stepMs),
      herald: "The crown requires 80 ore for the armory.",
    };
    const crownView = (
      crown: Omit<NonNullable<GameView["crown"]>, "favor"> &
        Partial<Pick<NonNullable<GameView["crown"]>, "favor">>,
    ) =>
      emptyView({
        crown: { favor: "neutral", ...crown },
        unlocks: [CROWN_PANEL],
      });

    test("an open demand shows its whole herald, progress, time left, tally and the deliver hint", async () => {
      const frame = await drawPanels(
        [crownView({ demand, nextDemandTicks: null, met: 3, missed: 1 })],
        { focus: "crown", size: { width: 160, height: 30 } },
      );

      expect(frame).toContain(demand.herald);
      expect(frame).toContain(
        copy.village.crownProgress({
          resource: "ore",
          delivered: "45",
          amount: "80",
        }),
      );
      expect(frame).toContain(
        copy.village.crownDueIn({
          wait: formatTicks(demand.ticksLeft, tuning.stepMs),
        }),
      );
      expect(frame).toContain(copy.village.crownTally({ met: 3, missed: 1 }));
      expect(frame).toContain(keymap.panelHintsText("crown", 1000));
    });

    test("the panel names the crown's mood in words and never shows the favor number", async () => {
      const frames = await Promise.all(
        (["cold", "neutral", "warm"] as const).map((favor) =>
          drawPanels(
            [
              crownView({
                demand: null,
                nextDemandTicks: 10,
                met: 0,
                missed: 0,
                favor,
              }),
            ],
            {
              size: { width: 160, height: 30 },
            },
          ),
        ),
      );

      expect(frames[0]).toContain(copy.village.crownFavor.cold);
      expect(frames[1]).toContain(copy.village.crownFavor.neutral);
      expect(frames[2]).toContain(copy.village.crownFavor.warm);
      expect(frames[0]).not.toContain(copy.village.crownFavor.warm);
    });

    test("between demands the panel says the crown is quiet and when the next one comes", async () => {
      const nextDemandTicks = 120 * (1000 / tuning.stepMs);
      const frame = await drawPanels(
        [crownView({ demand: null, nextDemandTicks, met: 0, missed: 0 })],
        { size: { width: 160, height: 30 } },
      );

      const wait = formatTicksRoughly(nextDemandTicks, tuning.stepMs);
      expect(frame).toContain(copy.village.crownQuiet({ wait }));
      expect(frame).not.toContain(
        copy.village.crownDueIn({
          wait: formatTicks(nextDemandTicks, tuning.stepMs),
        }),
      );
    });
  });

  describe("keys", () => {
    const panel = new Village().focusable.crown;
    const context = { view: emptyView(), tuning };

    test("enter delivers, the forge key forges, an unowned key falls through and the title marks the focus key", () => {
      expect(panel.key(key("enter"), context)?.commands).toEqual([
        { type: "deliver" },
      ]);
      expect(panel.key(key("f"), context)?.commands).toEqual([
        { type: "forge" },
      ]);
      expect(panel.key(key("z"), context)).toBeNull();
      expect(panel.title).toBe("C(r)own");
    });
  });
});
