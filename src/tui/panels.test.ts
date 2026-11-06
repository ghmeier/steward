import { afterEach, describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { tuning } from "../../test/helpers";
import { barRow, settledFrame } from "../../test/tui-helpers";
import { Job, RESOURCES } from "../core/realm";
import { CROWN_PANEL, PALETTE_UNLOCK, type UnlockId } from "../core/unlocks";
import type { GameView } from "../core/view";
import { formatAmount, formatGameTime, formatRate } from "./format";
import { BAR_HINTS, type FocusId } from "./keys";
import { createPanels } from "./panels";
import { Village } from "./village-panels";

type Setup = Awaited<ReturnType<typeof createTestRenderer>>;
const setups: Setup[] = [];

afterEach(async () => {
  for (const setup of setups.splice(0)) await setup.dispose();
});

type DrawOptions = {
  size?: { width: number; height: number };
  focus?: FocusId | null;
  /** Index of the selected peasant in the roster; only shown while Peasants is focused. */
  selectedIndex?: number;
};

async function draw(
  views: GameView[],
  {
    size = { width: 100, height: 30 },
    focus = null,
    selectedIndex = 0,
  }: DrawOptions = {},
) {
  const setup = await createTestRenderer({ ...size, exitOnCtrlC: false });
  setups.push(setup);
  const village = new Village();
  const panels = createPanels(setup.renderer, village);
  let frame = "";
  for (const view of views) {
    const context = { view, tuning };
    village.peasants.reset(view);
    if (focus !== null) village.focusable[focus].enter(context);
    for (let step = 0; step < selectedIndex; step++) {
      village.peasants.key(pressed("j"), context);
    }
    panels.update({ context, message: null, focus });
    frame = await settledFrame(setup);
  }
  return frame;
}

function pressed(name: string) {
  return { name, ctrl: false, meta: false, shift: false, sequence: name };
}

function emptyView(overrides: Partial<GameView> = {}): GameView {
  return {
    tick: 0,
    elapsedSeconds: 0,
    ledger: [],
    deskExpiry: { id: 0, line: "" },
    realm: {
      population: 10,
      labor: { farm: 0, forest: 0, mine: 0, idle: 10 },
      season: "spring",
      starved: 0,
    },
    delegates: [],
    decrees: [],
    savedDecrees: [],
    desk: [],
    governors: [],
    crown: null,
    promotion: { target: 20, promotedAt: 0, promotedAtSeconds: 0 },
    growth: { stored: 0, needed: 25, perSecond: 0, full: false },
    lockedPanels: [],
    unlocks: [],
    archive: { open: false, entries: [] },
    ...overrides,
  };
}

const ada = { id: 3, name: "Ada", job: Job.FARM, grudgeTicks: 0 };
const dispute = {
  id: 1,
  kind: "dispute" as const,
  label: "A squabble",
  parties: ["Ada", "Bram"] as [string, string],
  options: [],
};
const growth = (changes: Partial<GameView["growth"]>) => ({
  stored: 12.4,
  needed: 25,
  perSecond: 0.5,
  full: false,
  ...changes,
});
const realmOf = (changes: Partial<GameView["realm"]>) => ({
  ...emptyView().realm,
  ...changes,
});

describe("createPanels", () => {
  test.each([
    { width: 100, height: 30 },
    { width: 80, height: 24 },
  ])(
    "shows all six titles and the bar hints at $width x $height",
    async (size) => {
      const frame = await draw([emptyView()], {
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
      expect(frame).toContain(BAR_HINTS);
    },
  );

  test("the top row splits one to one to two and the bottom row into thirds", async () => {
    const frame = await draw([emptyView()], {
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
    near(offset(lines[top] ?? "", "(A)rchive", "(L)edger"), 80);
    near(offset(lines[bottom] ?? "", "(D)ecrees", "(C)ourt"), 160 / 3);
    near(offset(lines[bottom] ?? "", "C(r)own", "(C)ourt"), (2 * 160) / 3);
  });

  describe("the bottom bar", () => {
    async function drawnBar(
      unlocks: UnlockId[],
      message: string | null,
      width = 100,
    ) {
      const setup = await createTestRenderer({ width, height: 30 });
      setups.push(setup);
      const panels = createPanels(setup.renderer, new Village());
      panels.update({
        context: { view: emptyView({ unlocks }), tuning },
        message,
        focus: null,
      });
      return barRow(await settledFrame(setup));
    }

    test("the commands reminder sits on the left once the palette is owned and the notice sits right before the help hints", async () => {
      const owned = await drawnBar([PALETTE_UNLOCK], "Saved.");
      const locked = await drawnBar([], null);

      expect(owned.startsWith(": commands")).toBe(true);
      expect(owned.trimEnd().endsWith(`Saved. ${BAR_HINTS}`)).toBe(true);
      expect(locked.trim()).toBe(BAR_HINTS);
    });

    test.each([{ width: 100 }, { width: 160 }])(
      "a notice too long for the bar keeps its start and loses its end before the hints at $width columns",
      async ({ width }) => {
        const notice = `Save failed: ${"the reason goes on. ".repeat(20)}`;

        const row = await drawnBar([PALETTE_UNLOCK], notice, width);

        expect(row.startsWith(": commands Save failed:")).toBe(true);
        expect(row.endsWith(`\u2026 ${BAR_HINTS}`)).toBe(true);
        expect(row.length).toBe(width);
      },
    );
  });

  test("the ledger shows the time, resources in shared columns, then the realm after a blank line", async () => {
    const view = emptyView({
      elapsedSeconds: 185,
      ledger: [
        { resource: "grain", amount: 5, ratePerSecond: 1 },
        { resource: "timber", amount: 1234567.8, ratePerSecond: -22.5 },
      ],
      realm: realmOf({
        population: 12,
        labor: { farm: 4, forest: 2, mine: 1, idle: 5 },
        season: "summer",
      }),
    });

    const frame = await draw([view], { size: { width: 160, height: 45 } });

    const lines = frame.split("\n");
    const row = (text: string) => lines.findIndex((l) => l.includes(text));
    const line = (text: string) => lines[row(text)] ?? "";
    const endOf = (text: string, part: string) =>
      line(text).indexOf(part) + part.length;
    expect(frame).toContain(`Time  ${formatGameTime(185)}`);
    expect(endOf("Grain", formatAmount(5))).toBe(
      endOf("Timber", formatAmount(1234567.8)),
    );
    expect(endOf("Grain", formatRate(1))).toBe(
      endOf("Timber", formatRate(-22.5)),
    );
    expect(line("Peasants 12").indexOf("Peasants 12")).toBe(
      line("Grain").indexOf("Grain"),
    );
    expect(row("Peasants 12 (5 idle)")).toBe(row("Timber") + 2);
    expect(frame).toContain("Farm 4 Forest 2 Mine 1");
    expect(frame).toContain("Season Summer");
  });

  test("the ledger keeps promotion and next peasant on one line when wide and splits them when narrow", async () => {
    const view = emptyView({
      realm: realmOf({ population: 14 }),
      growth: growth({}),
    });

    const wide = (
      await draw([view], { size: { width: 160, height: 45 } })
    ).split("\n");
    const narrow = (await draw([view])).split("\n");

    const column = (lines: string[], offset: number, label: string) => {
      const ledgerWidth = (lines[0]?.length ?? 0) / 4;
      const line = lines[lines.findIndex((l) => l.includes(label)) + offset];
      return (line ?? "").slice(1, ledgerWidth).trim();
    };
    expect(column(wide, 0, "Promotion")).toBe("Promotion  14 / 20 peasants");
    expect(column(wide, 0, "Next peasant")).toBe(
      "Next peasant  12.4 / 25 grain  (~26s)",
    );
    expect(column(narrow, 0, "Promotion")).toBe("Promotion");
    expect(column(narrow, 1, "Promotion")).toBe("14 / 20 peasants");
    expect(column(narrow, 0, "Next peasant")).toBe("Next peasant");
    expect(column(narrow, 1, "Next peasant")).toContain("12.4 / 25 grain");
  });

  test("the ledger gives up the time line only when the panel is too short for everything", async () => {
    const view = emptyView({
      ledger: RESOURCES.map((resource) => ({
        resource,
        amount: 1,
        ratePerSecond: 0,
      })),
      growth: growth({}),
    });

    const tall = await draw([view], { size: { width: 160, height: 45 } });
    const short = await draw([view]);

    expect(tall).toContain("Time  ");
    expect(short).not.toContain("Time  ");
    expect(short).toContain("Next peasant");
  });

  test("the ledger keeps the time line at 100 by 30 where the real panel has room for it", async () => {
    const view = emptyView({
      ledger: RESOURCES.map((resource) => ({
        resource,
        amount: 1,
        ratePerSecond: 0,
      })),
      growth: growth({ full: true }),
    });

    const frame = await draw([view]);

    expect(frame).toContain("Time  ");
    expect(frame).toContain("Season Spring");
  });

  test("an update replaces the values of the last view", async () => {
    const grain = (amount: number) =>
      emptyView({ ledger: [{ resource: "grain", amount, ratePerSecond: 1 }] });

    const frame = await draw([grain(111), grain(222_222)]);

    expect(frame).not.toContain(formatAmount(111));
    expect(frame).toContain(formatAmount(222_222));
  });

  test.each([
    ["the desk", emptyView(), "The desk is clear."],
    [
      "the roster",
      emptyView({
        realm: realmOf({
          population: 0,
          labor: { farm: 0, forest: 0, mine: 0, idle: 0 },
        }),
      }),
      "village is empty",
    ],
  ])(
    "%s shows a placeholder when it has nothing",
    async (_name, view, words) => {
      const frame = await draw([view], {
        size: { width: 160, height: 30 },
      });

      expect(frame).toContain(words);
    },
  );

  test("entries replace the placeholders", async () => {
    const view = emptyView({ desk: [dispute], delegates: [ada] });

    const frame = await draw([view]);

    for (const shown of ["A squabble", "Ada"]) {
      expect(frame).toContain(shown);
    }
    for (const gone of ["is clear", "village is empty"]) {
      expect(frame).not.toContain(gone);
    }
  });

  test("an entry without parties shows its label like any other", async () => {
    const merchant = {
      id: 2,
      kind: "merchant" as const,
      label: "A smith wants ore",
      parties: null,
      options: [],
    };
    const view = emptyView({ desk: [merchant] });

    const frame = await draw([view]);

    expect(frame).toContain("A smith wants ore");
    expect(frame).not.toContain("is clear");
  });

  test("the decrees panel lists every petition with its decree or none", async () => {
    const view = emptyView({
      decrees: [
        {
          id: "granary",
          petition: "wood",
          rules: [],
          otherwise: "stockpile",
        },
      ],
    });

    const frame = await draw([view], { size: { width: 160, height: 30 } });

    expect(frame).toMatch(/harvest {2}none/);
    expect(frame).toMatch(/wood {5}otherwise stockpile/);
    expect(frame).toMatch(/ore {6}none/);
    expect(frame).toMatch(/labor {4}none/);
  });

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

    const unfocused = await draw([view]);
    const focused = await draw([view], { focus: "archive" });

    expect(unfocused).toContain("Alpha  100 coin");
    expect(unfocused).toContain("Beta  owned");
    expect(unfocused).not.toContain("Opens the first door.");
    expect(focused).toContain("> Alpha  100 coin");
    expect(focused).toContain("Opens the first door.");
    expect(focused).not.toContain("Opens the second door.");
  });

  test("the focused panel gets a double border and its hints while the others show neither", async () => {
    const view = emptyView({ delegates: [ada] });

    const frame = await draw([view], {
      focus: "peasants",
      size: { width: 200, height: 30 },
    });

    const lines = frame.split("\n");
    const top = lines.find((line) => line.includes("(P)easants")) ?? "";
    const bottom = lines.find((line) => line.includes("j/k select")) ?? "";
    expect(top).toContain("\u2554");
    expect(bottom).toContain("f/w/m/i");
    expect(frame.match(/\u2554/g)?.length).toBe(1);
    expect(frame.match(/j\/k select/g)?.length).toBe(1);
  });

  test("a focused panel too narrow for its full hints shows the bare keys instead", async () => {
    const frame = await draw([emptyView({ delegates: [ada] })], {
      focus: "peasants",
    });

    expect(frame).toContain("j/k f/w/m/i esc");
    expect(frame).not.toContain("select");
  });

  test("peasants show a cursor only while the panel is focused", async () => {
    const view = emptyView({
      delegates: [
        ada,
        { ...ada, id: 4, name: "Bram", job: Job.IDLE, grudgeTicks: 30 },
      ],
    });

    const unfocused = await draw([view], { selectedIndex: 1 });
    const focused = await draw([view], {
      focus: "peasants",
      selectedIndex: 1,
    });

    expect(unfocused).not.toContain("> ");
    expect(focused).toMatch(/ {2}Ada {2}farm/);
    expect(focused).toMatch(/> Bram {2}idle \(grudge\)/);
    expect(focused).not.toMatch(/> Ada/);
  });

  describe("the Crown panel", () => {
    const demand = {
      resource: "ore" as const,
      amount: 80,
      delivered: 45,
      ticksLeft: 80 * (1000 / tuning.stepMs),
      herald: "The crown requires 80 ore for the armory.",
    };
    const crownView = (crown: GameView["crown"]) =>
      emptyView({ crown, unlocks: [CROWN_PANEL] });

    test("an open demand shows its whole herald, progress, time left, tally and the deliver hint", async () => {
      const frame = await draw(
        [crownView({ demand, nextDemandTicks: null, met: 3, missed: 1 })],
        { focus: "crown" },
      );

      expect(frame).toContain(demand.herald.slice(0, 20));
      expect(frame).toContain("armory.");
      expect(frame).toContain("ore 45 / 80");
      expect(frame).toContain("due in 1m 20s");
      expect(frame).toContain("Met 3 \u00b7 missed 1");
      expect(frame).toContain("enter deliver \u00b7 esc back");
    });

    test("between demands the panel says the crown is quiet and when the next one comes", async () => {
      const frame = await draw([
        crownView({
          demand: null,
          nextDemandTicks: 120 * (1000 / tuning.stepMs),
          met: 0,
          missed: 0,
        }),
      ]);

      expect(frame).toContain("The crown is quiet.");
      expect(frame).toContain("about 2m");
      expect(frame).not.toContain("due in");
    });
  });

  test("a locked panel keeps its title but hides its content", async () => {
    const view = emptyView({
      lockedPanels: ["archive"],
      archive: {
        open: false,
        entries: [
          {
            id: "a",
            label: "Alpha",
            description: "",
            cost: 100,
            owned: false,
            affordable: false,
            available: true,
          },
        ],
      },
    });

    const frame = await draw([view]);

    expect(frame).toContain("(A)rchive");
    expect(frame).toContain("Locked.");
    expect(frame).not.toContain("Alpha");
  });

  test.each([
    [
      "before promotion",
      { target: 20, promotedAt: 0, promotedAtSeconds: 0 },
      14,
      ["14 / 20"],
      ["Promoted"],
    ],
    [
      "after promotion",
      { target: 20, promotedAt: 1200, promotedAtSeconds: 120 },
      14,
      [formatGameTime(120), "Promoted"],
      ["14 / 20"],
    ],
  ])("the ledger %s", async (_name, promotion, population, has, lacks) => {
    const view = emptyView({ promotion, realm: realmOf({ population }) });

    const frame = await draw([view]);

    for (const shown of has) expect(frame).toContain(shown);
    for (const gone of lacks) expect(frame).not.toContain(gone);
  });

  test.each([
    [
      "a feeding village shows progress and time",
      growth({}),
      ["12.4 / 25 grain", "~26s"],
    ],
    [
      "a village that is not feeding shows no estimate",
      growth({ perSecond: 0 }),
      ["12.4 / 25 grain", "!~"],
    ],
    ["a full village shows no line", growth({ full: true }), ["!Next peasant"]],
  ])("%s", async (_name, value, words) => {
    const frame = await draw([emptyView({ growth: value })]);

    for (const word of words) {
      if (word.startsWith("!")) expect(frame).not.toContain(word.slice(1));
      else expect(frame).toContain(word);
    }
  });

  test.each([
    [29, ["> Peasant30", "\u2191", "\u2193"], []],
    [0, ["> Peasant1", "\u2193"], ["\u2191"]],
  ])(
    "with 40 peasants and index %d selected, the list scrolls to it",
    async (selectedIndex, has, lacks) => {
      const crowd = emptyView({
        delegates: Array.from({ length: 40 }, (_, index) => ({
          ...ada,
          id: index + 1,
          name: `Peasant${index + 1}`,
          job: Job.IDLE,
        })),
      });

      const frame = await draw([crowd], {
        focus: "peasants",
        selectedIndex,
      });

      for (const shown of has) expect(frame).toContain(shown);
      for (const gone of lacks) expect(frame).not.toContain(gone);
    },
  );
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
    const setup = await createTestRenderer({ width: 160, height: 45 });
    setups.push(setup);
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
    expect(one).not.toContain(BAR_HINTS);
    expect(closed).toContain(BAR_HINTS);
    expect(closed).not.toContain("tab complete");
  });

  test("a shorter terminal has a smaller suggestion budget", async () => {
    const budget = async (height: number) => {
      const setup = await createTestRenderer({ width: 100, height });
      setups.push(setup);
      return createPanels(setup.renderer, new Village()).lineSuggestionBudget;
    };

    expect(await budget(45)).toBeGreaterThanOrEqual(6);
    expect(await budget(14)).toBeLessThan(6);
  });
});
