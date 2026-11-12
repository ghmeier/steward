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
  test("the archive panel shows each entry's price and owned state, and the selected entry's description only while focused", async () => {
    const view = emptyView({
      archive: {
        open: true,
        entries: [
          {
            id: "a",
            label: "Alpha",
            description: "Opens the first door.",
            cost: 100,
            owned: false,
            affordable: false,
            available: true,
          },
          {
            id: "b",
            label: "Beta",
            description: "Opens the second door.",
            cost: 200,
            owned: true,
            affordable: true,
            available: true,
          },
        ],
      },
    });

    const unfocused = await drawPanels([view]);
    const focused = await drawPanels([view], { focus: "archive" });

    const alpha = `Alpha  ${copy.village.archiveCost({ cost: "100" })}`;
    expect(unfocused).toContain(alpha);
    expect(unfocused).toContain(`Beta  ${copy.village.archiveOwned}`);
    expect(unfocused).not.toContain("Opens the first door.");
    expect(focused).toContain(`> ${alpha}`);
    expect(focused).toContain("Opens the first door.");
    expect(focused).not.toContain("Opens the second door.");
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
                cost: 100,
                owned: false,
                affordable: true,
                available: true,
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
