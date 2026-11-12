import { describe, expect, test } from "bun:test";
import { tuning } from "../../test/helpers";
import {
  disposeDrawnPanels,
  drawPanels,
  emptyView,
  key,
} from "../../test/tui-helpers";
import { copy } from "../core/copy";
import { Village } from "./village-panels";

disposeDrawnPanels();

describe("the Archive panel", () => {
  test("the archive panel shows each entry's mixed price, and the selected entry's description only while focused", async () => {
    const view = emptyView({
      archive: {
        open: true,
        entries: [
          {
            id: "a",
            label: "Alpha",
            description: "Opens the first door.",
            cost: [
              { resource: "wood", amount: 40, held: 0, affordable: false },
              { resource: "ore", amount: 10, held: 0, affordable: false },
            ],
            affordable: false,
          },
          {
            id: "b",
            label: "Beta",
            description: "Opens the second door.",
            cost: [
              { resource: "coin", amount: 200, held: 200, affordable: true },
            ],
            affordable: true,
          },
        ],
      },
    });

    const unfocused = await drawPanels([view], {
      size: { width: 150, height: 30 },
    });
    const focused = await drawPanels([view], {
      focus: "archive",
      size: { width: 150, height: 30 },
    });

    const alpha = "Alpha  40 wood · 10 ore";
    expect(unfocused).toContain(alpha);
    expect(unfocused).toContain("Beta  200 coin");
    expect(unfocused).not.toContain("Opens the first door.");
    expect(focused).toContain(`> ${alpha}`);
    expect(focused).toContain("Opens the first door.");
    expect(focused).not.toContain("Opens the second door.");
  });

  test("an empty archive says there is nothing more to learn", async () => {
    const view = emptyView({ archive: { open: true, entries: [] } });

    const unfocused = await drawPanels([view], {
      size: { width: 150, height: 30 },
    });
    const focused = await drawPanels([view], {
      focus: "archive",
      size: { width: 150, height: 30 },
    });

    expect(unfocused).toContain(copy.village.archiveEmpty);
    expect(focused).toContain(copy.village.archiveEmpty);
  });

  describe("keys", () => {
    test("enter buys the selected entry and escape gives up focus", () => {
      const context = {
        view: emptyView({
          archive: {
            open: true,
            entries: [
              {
                id: "a",
                label: "Alpha",
                description: "Opens the first door.",
                cost: [
                  {
                    resource: "coin",
                    amount: 100,
                    held: 100,
                    affordable: true,
                  },
                ],
                affordable: true,
              },
            ],
          },
        }),
        tuning,
      };
      const panel = new Village().focusable.archive;
      panel.enter(context);

      const buy = panel.key(key("enter"), context);
      const escaped = panel.key(key("escape"), context);

      expect(buy?.commands).toEqual([{ type: "buyUnlock", id: "a" }]);
      expect(escaped?.requests).toEqual([{ kind: "unfocus" }]);
    });
  });
});
