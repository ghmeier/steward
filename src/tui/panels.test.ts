import { afterEach, describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { tuning } from "../../test/helpers";
import { Job } from "../core/realm";
import type { GameView } from "../core/view";
import { formatAmount, formatGameTime, formatRate } from "./format";
import type { FocusId } from "./keys";
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
  bar: string,
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
    for (let step = 0; step < selectedIndex; step++) {
      village.peasants.key(pressed("j"), context);
    }
    panels.update({ context, message: null, barHints: bar, focus });
    await setup.renderOnce();
    frame = setup.captureCharFrame();
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
    "shows all five titles and the bar hints at $width x $height",
    async (size) => {
      const frame = await draw([emptyView()], "(?)Help (N)ew village (Q)uit", {
        size,
      });

      for (const title of [
        "(L)edger",
        "(P)easants",
        "(A)rchive",
        "(C)ourt",
        "(D)ecrees",
      ]) {
        expect(frame).toContain(title);
      }
      expect(frame).toContain("(?)Help (N)ew village (Q)uit");
    },
  );

  test("the top row splits one to one to two and the bottom row one to one", async () => {
    const frame = await draw([emptyView()], "", {
      size: { width: 160, height: 30 },
    });

    const lines = frame.split("\n");
    const top = lines.findIndex((line) => line.includes("(L)edger"));
    const bottom = lines.findIndex((line) => line.includes("(C)ourt"));
    const column = (line: string, title: string) => line.indexOf(title) - 2;
    // The renderer rounds fractional widths, so a column may land one off its exact share.
    const near = (actual: number, expected: number) =>
      expect(Math.abs(actual - expected)).toBeLessThanOrEqual(2);
    near(column(lines[top] ?? "", "(P)easants"), 40);
    near(column(lines[top] ?? "", "(A)rchive"), 80);
    near(column(lines[bottom] ?? "", "(D)ecrees"), 80);
  });

  test("the message sits on the left of the bar and the hints on the right", async () => {
    const setup = await createTestRenderer({ width: 100, height: 30 });
    setups.push(setup);
    const village = new Village();
    const panels = createPanels(setup.renderer, village);

    panels.update({
      context: { view: emptyView(), tuning },
      message: "Saved.",
      barHints: "(?)Help (N)ew village (Q)uit",
      focus: null,
    });
    await setup.renderOnce();

    const last = setup.captureCharFrame().split("\n").at(-2) ?? "";
    expect(last.startsWith("Saved.")).toBe(true);
    expect(last.trimEnd().endsWith("(Q)uit")).toBe(true);
  });

  test("the ledger shows the game time and each resource's name, amount and rate in shared columns", async () => {
    const view = emptyView({
      elapsedSeconds: 185,
      ledger: [
        { resource: "grain", amount: 5, ratePerSecond: 1 },
        { resource: "timber", amount: 1234567.8, ratePerSecond: -22.5 },
      ],
    });

    const frame = await draw([view], "");

    const lines = frame.split("\n");
    const grain = lines.find((l) => l.includes("Grain")) ?? "";
    const timber = lines.find((l) => l.includes("Timber")) ?? "";
    const endOf = (line: string, text: string) =>
      line.indexOf(text) + text.length;
    expect(frame).toContain(formatGameTime(185));
    expect(endOf(grain, formatAmount(5))).toBe(
      endOf(timber, formatAmount(1234567.8)),
    );
    expect(endOf(grain, formatRate(1))).toBe(endOf(timber, formatRate(-22.5)));
  });

  test("the ledger shows population, labor and season aligned under the resource names", async () => {
    const view = emptyView({
      ledger: [{ resource: "grain", amount: 5, ratePerSecond: 1 }],
      realm: realmOf({
        population: 12,
        labor: { farm: 4, forest: 2, mine: 1, idle: 5 },
        season: "summer",
      }),
    });

    const frame = await draw([view], "");

    const lines = frame.split("\n");
    const column = (text: string) =>
      (lines.find((l) => l.includes(text)) ?? "").indexOf(text);
    expect(frame).toContain("Peasants 12 (5 idle)");
    expect(frame).toContain("Farm 4 Forest 2 Mine 1");
    expect(frame).toContain("Season Summer");
    expect(column("Peasants 12")).toBe(column("Grain"));
  });

  test("the ledger splits the next peasant and promotion lines in two so a quarter-width column shows them whole", async () => {
    const view = emptyView({
      realm: realmOf({ population: 14 }),
      growth: growth({}),
    });

    const lines = (await draw([view], "")).split("\n");

    const column = (line: string) => line.slice(1, 25).trimEnd();
    const next = lines.findIndex((line) => line.includes("Next peasant"));
    const promotion = lines.findIndex((line) => line.includes("Promotion"));
    expect(column(lines[next] ?? "")).toContain("Next peasant (~26s)");
    expect(column(lines[next + 1] ?? "")).toContain("12.4 / 25 grain");
    expect(column(lines[promotion] ?? "")).toContain("Promotion");
    expect(column(lines[promotion + 1] ?? "")).toContain("14 / 20 peasants");
  });

  test("an update replaces the values of the last view", async () => {
    const grain = (amount: number) =>
      emptyView({ ledger: [{ resource: "grain", amount, ratePerSecond: 1 }] });

    const frame = await draw([grain(111), grain(222_222)], "");

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
      const frame = await draw([view], "", {
        size: { width: 160, height: 30 },
      });

      expect(frame).toContain(words);
    },
  );

  test("entries replace the placeholders", async () => {
    const view = emptyView({ desk: [dispute], delegates: [ada] });

    const frame = await draw([view], "");

    for (const shown of ["A squabble", "Ada"]) {
      expect(frame).toContain(shown);
    }
    for (const gone of ["is clear", "village is empty"]) {
      expect(frame).not.toContain(gone);
    }
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

    const frame = await draw([view], "", { size: { width: 160, height: 30 } });

    expect(frame).toMatch(/harvest {2}none/);
    expect(frame).toMatch(/wood {5}otherwise stockpile/);
    expect(frame).toMatch(/ore {6}none/);
    expect(frame).toMatch(/labor {4}none/);
  });

  test("the archive panel shows each entry with its price and owned state", async () => {
    const view = emptyView({
      archive: {
        open: true,
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
          {
            id: "b",
            label: "Beta",
            description: "",
            cost: 200,
            owned: true,
            affordable: true,
            available: true,
          },
        ],
      },
    });

    const frame = await draw([view], "");

    expect(frame).toContain("Alpha  100 coin");
    expect(frame).toContain("Beta  owned");
  });

  test("the focused panel gets a double border and its hints while the others show neither", async () => {
    const view = emptyView({ delegates: [ada] });

    const frame = await draw([view], "", {
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
    const frame = await draw([emptyView({ delegates: [ada] })], "", {
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

    const unfocused = await draw([view], "", { selectedIndex: 1 });
    const focused = await draw([view], "", {
      focus: "peasants",
      selectedIndex: 1,
    });

    expect(unfocused).not.toContain("> ");
    expect(focused).toMatch(/ {2}Ada {2}farm/);
    expect(focused).toMatch(/> Bram {2}idle \(grudge\)/);
    expect(focused).not.toMatch(/> Ada/);
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

    const frame = await draw([view], "");

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

    const frame = await draw([view], "");

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
    const frame = await draw([emptyView({ growth: value })], "");

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

      const frame = await draw([crowd], "", {
        focus: "peasants",
        selectedIndex,
      });

      for (const shown of has) expect(frame).toContain(shown);
      for (const gone of lacks) expect(frame).not.toContain(gone);
    },
  );
});
