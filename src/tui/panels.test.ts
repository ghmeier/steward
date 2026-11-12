import { describe, expect, test } from "bun:test";
import { tuning } from "../../test/helpers";
import {
  ada,
  barRow,
  disposeDrawnPanels,
  dispute,
  drawPanels,
  emptyView,
  openRenderer,
  settledFrame,
} from "../../test/tui-helpers";
import { copy } from "../core/copy";
import {
  ARCHIVE_PANEL,
  CROWN_PANEL,
  PALETTE_UNLOCK,
  type UnlockId,
} from "../core/unlocks";
import { createPanels } from "./panels";
import { keymap, Village } from "./village-panels";

disposeDrawnPanels();

describe("createPanels", () => {
  test.each([
    { width: 100, height: 30 },
    { width: 80, height: 24 },
  ])(
    "shows all six titles and the bar hints at $width x $height",
    async (size) => {
      const frame = await drawPanels([emptyView()], {
        size,
      });

      for (const title of [
        "(L)edger",
        "(P)easants",
        "(A)rchive",
        "(C)ourt",
        "(D)ecrees",
        "C(r)own",
      ]) {
        expect(frame).toContain(title);
      }
      expect(frame).toContain(copy.keys.barHints);
    },
  );

  test("the top row splits one to two to one and the bottom row into thirds", async () => {
    const frame = await drawPanels([emptyView()], {
      size: { width: 160, height: 30 },
    });

    const lines = frame.split("\n");
    const top = lines.findIndex((line) => line.includes("(L)edger"));
    const bottom = lines.findIndex((line) => line.includes("(C)ourt"));
    const offset = (line: string, title: string, origin: string) =>
      line.indexOf(title) - line.indexOf(origin);
    // Yoga hands the rounding remainder of a fractional split to the first panels, so a column may land up to two off its exact share.
    const near = (actual: number, expected: number) =>
      expect(Math.abs(actual - expected)).toBeLessThanOrEqual(2);
    near(offset(lines[top] ?? "", "(P)easants", "(L)edger"), 40);
    near(offset(lines[top] ?? "", "(A)rchive", "(L)edger"), 120);
    near(offset(lines[bottom] ?? "", "(D)ecrees", "(C)ourt"), 160 / 3);
    near(offset(lines[bottom] ?? "", "C(r)own", "(C)ourt"), (2 * 160) / 3);
  });

  describe("a locked Archive", () => {
    const topTitleRow = (frame: string) =>
      frame.split("\n").find((line) => line.includes("(L)edger")) ?? "";
    const size = { width: 160, height: 30 };

    test("is not drawn and leaves the top row to the Ledger and Peasants", async () => {
      const frame = await drawPanels(
        [emptyView({ lockedPanels: ["archive"] })],
        {
          size,
        },
      );

      expect(frame).not.toContain("(A)rchive");
      expect(topTitleRow(frame).match(/\u250c/g)).toHaveLength(2);
    });

    test("appears in the top row once the panel is owned", async () => {
      const frame = await drawPanels(
        [
          emptyView({ lockedPanels: ["archive"] }),
          emptyView({ unlocks: [ARCHIVE_PANEL] }),
        ],
        { size },
      );

      expect(frame).toContain("(A)rchive");
      expect(topTitleRow(frame).match(/\u250c/g)).toHaveLength(3);
    });
  });

  describe("a locked Court", () => {
    test("is not drawn until the panel is owned, and then is", async () => {
      const locked = await drawPanels([emptyView({ lockedPanels: ["court"] })]);
      const owned = await drawPanels([emptyView()]);

      expect(locked).not.toContain("(C)ourt");
      expect(owned).toContain("(C)ourt");
    });
  });

  describe("a locked Crown", () => {
    const label = "A squabble over the miller's grain share";
    const desk = [{ ...dispute, label }];
    const size = { width: 100, height: 30 };
    const bottomTitleRow = (frame: string) =>
      frame.split("\n").find((line) => line.includes("(C)ourt")) ?? "";

    test("is not drawn and leaves the bottom row to a wider Court and Decrees", async () => {
      const frame = await drawPanels(
        [emptyView({ lockedPanels: ["crown"], desk })],
        {
          size,
        },
      );

      const row = bottomTitleRow(frame);
      expect(frame).not.toContain("C(r)own");
      expect(row.match(/\u250c/g)).toHaveLength(2);
      expect(row.indexOf("(D)ecrees") - row.indexOf("(C)ourt")).toBeCloseTo(
        size.width / 2,
        -1,
      );
      expect(frame).toContain(label);
    });

    test("appears as the third column and narrows Court once the panel is owned", async () => {
      const frame = await drawPanels(
        [
          emptyView({ lockedPanels: ["crown"], desk }),
          emptyView({ unlocks: [CROWN_PANEL], desk }),
        ],
        { size },
      );

      const row = bottomTitleRow(frame);
      expect(row.match(/\u250c/g)).toHaveLength(3);
      expect(row.indexOf("C(r)own") - row.indexOf("(C)ourt")).toBeGreaterThan(
        (size.width * 2) / 3 - 3,
      );
      expect(frame).not.toContain(label);
    });
  });

  describe("the bottom bar", () => {
    async function drawnBar(
      unlocks: UnlockId[],
      message: string | null,
      width = 100,
    ) {
      const setup = await openRenderer(width, 30);
      const panels = createPanels(setup.renderer, new Village());
      panels.update({
        context: { view: emptyView({ unlocks }), tuning },
        message,
        focus: null,
      });
      return barRow(await settledFrame(setup));
    }

    test("the commands reminder sits on the left once the palette is owned and the notice sits right before the help hints", async () => {
      const owned = await drawnBar([PALETTE_UNLOCK], copy.notices.saved);
      const locked = await drawnBar([], null);

      expect(owned.startsWith(": commands")).toBe(true);
      expect(
        owned.trimEnd().endsWith(`${copy.notices.saved} ${copy.keys.barHints}`),
      ).toBe(true);
      expect(locked.trim()).toBe(copy.keys.barHints);
    });

    test.each([{ width: 100 }, { width: 160 }])(
      "a notice too long for the bar keeps its start and loses its end before the hints at $width columns",
      async ({ width }) => {
        const notice = copy.notices.saveFailed({
          error: "the reason goes on. ".repeat(20),
        });

        const row = await drawnBar([PALETTE_UNLOCK], notice, width);

        expect(row.startsWith(`: commands ${notice.slice(0, 20)}`)).toBe(true);
        expect(row.endsWith(`\u2026 ${copy.keys.barHints}`)).toBe(true);
        expect(row.length).toBe(width);
      },
    );
  });

  test("entries replace the placeholders", async () => {
    const view = emptyView({ desk: [dispute], delegates: [ada] });

    const frame = await drawPanels([view]);

    for (const shown of ["A squabble", "Ada"]) {
      expect(frame).toContain(shown);
    }
    for (const gone of [copy.court.deskClear, copy.village.emptyVillage]) {
      expect(frame).not.toContain(gone);
    }
  });

  test("the focused panel gets a double border and its hints while the others show neither", async () => {
    const view = emptyView({ delegates: [ada] });

    const frame = await drawPanels([view], {
      focus: "peasants",
      size: { width: 200, height: 30 },
    });

    const hints = keymap.panelHintsText("peasants", 1000);
    const top = frame.split("\n").find((line) => line.includes("(P)easants"));
    expect(top).toContain("\u2554");
    expect(frame.match(/\u2554/g)?.length).toBe(1);
    expect(frame.split(hints)).toHaveLength(2);
  });

  test("a focused panel too narrow for its full hints shows the bare keys instead", async () => {
    const frame = await drawPanels([emptyView({ delegates: [ada] })], {
      focus: "peasants",
      size: { width: 60, height: 30 },
    });

    expect(frame).toContain(keymap.panelHintsText("peasants", 0));
    expect(frame).not.toContain(keymap.panelHintsText("peasants", 1000));
  });
});

describe("the command line in the bar", () => {
  const suggestion = (n: number) => `  option${n}`;
  const lineWith = (suggestions: number, extra: string[] = []) => ({
    title: "Command",
    lines: [
      ": _",
      ...Array.from({ length: suggestions }, (_, n) => suggestion(n)),
      ...extra,
    ],
    hints: "tab complete · esc close",
  });

  async function openBar() {
    const setup = await openRenderer(160, 45);
    const village = new Village();
    const panels = createPanels(setup.renderer, village);
    panels.update({
      context: { view: emptyView(), tuning },
      message: null,
      focus: null,
    });
    return {
      panels,
      frame: () => settledFrame(setup),
    };
  }
  const rowsOf = (frame: string) => frame.split("\n");
  const barRows = (frame: string) => {
    const rows = rowsOf(frame);
    const top = rows.findIndex((row) => row.includes("Command"));
    return top === -1 ? 1 : rows.length - 1 - top;
  };

  test("the grid keeps its panels and their size while the line is open", async () => {
    const { panels, frame } = await openBar();
    const idle = rowsOf(await frame());

    panels.showLine(lineWith(4));
    const open = rowsOf(await frame());

    for (const title of ["(L)edger", "(P)easants", "(A)rchive", "(C)ourt"]) {
      expect(open.join("\n")).toContain(title);
    }
    const rowOf = (rows: string[], title: string) =>
      rows.findIndex((row) => row.includes(title));
    expect(rowOf(open, "(L)edger")).toBe(rowOf(idle, "(L)edger"));
    expect(rowOf(open, "(C)ourt")).toBe(rowOf(idle, "(C)ourt"));
  });

  test("the bar grows with the suggestions and the problem line under the line's hints, then collapses to the fixed hints", async () => {
    const { panels, frame } = await openBar();

    panels.showLine(lineWith(1));
    const one = await frame();
    panels.showLine(lineWith(5));
    const five = await frame();
    panels.showLine(lineWith(5, ['! "banana" is not a petition']));
    const withProblem = await frame();
    panels.showLine(null);
    const closed = await frame();

    expect(barRows(five) - barRows(one)).toBe(4);
    expect(barRows(withProblem) - barRows(five)).toBe(1);
    expect(barRows(closed)).toBe(1);
    expect(one).toContain("tab complete · esc close");
    expect(one).not.toContain(copy.keys.barHints);
    expect(closed).toContain(copy.keys.barHints);
    expect(closed).not.toContain("tab complete");
  });

  test("a shorter terminal has a smaller suggestion budget", async () => {
    const budget = async (height: number) => {
      const setup = await openRenderer(100, height);
      return createPanels(setup.renderer, new Village()).lineSuggestionBudget;
    };

    expect(await budget(45)).toBeGreaterThanOrEqual(6);
    expect(await budget(14)).toBeLessThan(6);
  });
});
