import { afterEach, describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import type { GameView } from "../src/core/view";
import { formatAmount, formatGameTime, formatRate } from "../src/tui/format";
import { createPanels } from "../src/tui/panels";

type Setup = Awaited<ReturnType<typeof createTestRenderer>>;
const setups: Setup[] = [];

afterEach(async () => {
  for (const setup of setups.splice(0)) await setup.dispose();
});

async function draw(
  views: GameView[],
  footer: string,
  size = { width: 100, height: 30 },
  selectedId: number | null = null,
) {
  const setup = await createTestRenderer({ ...size, exitOnCtrlC: false });
  setups.push(setup);
  const panels = createPanels(setup.renderer);
  let frame = "";
  for (const view of views) {
    panels.update(view, footer, selectedId);
    await setup.renderOnce();
    frame = setup.captureCharFrame();
  }
  return frame;
}

function emptyView(overrides: Partial<GameView> = {}): GameView {
  return {
    tick: 0,
    elapsedSeconds: 0,
    ledger: [],
    realm: {
      population: 10,
      idle: 10,
      labor: { farm: 0, forest: 0, mine: 0 },
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

const ada = { id: 3, name: "Ada", job: "farm" as const, grudgeTicks: 0 };
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
    "shows all four titles and the footer at $width x $height",
    async (size) => {
      const frame = await draw([emptyView()], "q quit", size);

      for (const title of ["Ledger", "Crown", "Desk", "Peasants"]) {
        expect(frame).toContain(title);
      }
      expect(frame).toContain("q quit");
    },
  );

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
        idle: 5,
        labor: { farm: 4, forest: 2, mine: 1 },
        season: "summer",
      }),
    });

    const frame = await draw([view], "");

    const lines = frame.split("\n");
    const column = (text: string) =>
      (lines.find((l) => l.includes(text)) ?? "").indexOf(text);
    expect(frame).toContain("Population  12 (5 idle)");
    expect(frame).toContain("Farm 4  Forest 2  Mine 1");
    expect(frame).toContain("Season  Summer");
    expect(column("Population")).toBe(column("Grain"));
  });

  test("an update replaces the values of the last view", async () => {
    const grain = (amount: number) =>
      emptyView({ ledger: [{ resource: "grain", amount, ratePerSecond: 1 }] });

    const frame = await draw([grain(111), grain(222_222)], "");

    expect(frame).not.toContain(formatAmount(111));
    expect(frame).toContain(formatAmount(222_222));
  });

  test.each([
    ["the crown", emptyView(), "demands nothing"],
    ["the desk", emptyView(), "is clear"],
    [
      "the roster",
      emptyView({ realm: realmOf({ population: 0, idle: 0 }) }),
      "village is empty",
    ],
  ])(
    "%s shows a placeholder when it has nothing",
    async (_name, view, words) => {
      const frame = await draw([view], "", { width: 160, height: 30 });

      expect(frame).toContain(words);
      expect(frame).not.toContain("hold court");
    },
  );

  test("entries replace the placeholders", async () => {
    const view = emptyView({
      crown: { label: "Tribute due" },
      desk: [dispute],
      delegates: [ada],
    });

    const frame = await draw([view], "");

    for (const shown of ["Tribute due", "A squabble", "Ada", "hold court"]) {
      expect(frame).toContain(shown);
    }
    for (const gone of ["demands nothing", "is clear", "village is empty"]) {
      expect(frame).not.toContain(gone);
    }
  });

  test("the roster marks the selected peasant and a grudge", async () => {
    const view = emptyView({
      delegates: [
        ada,
        { ...ada, id: 4, name: "Bram", job: "idle", grudgeTicks: 30 },
      ],
    });

    const frame = await draw([view], "", undefined, 4);

    expect(frame).toMatch(/ {2}Ada {2}farm/);
    expect(frame).toMatch(/> Bram {2}idle \(grudge\)/);
    expect(frame).not.toMatch(/> Ada/);
  });

  test("a locked panel keeps its title but hides its content", async () => {
    const view = emptyView({
      lockedPanels: ["crown"],
      crown: { label: "Tribute due" },
    });

    const frame = await draw([view], "");

    expect(frame).toContain("Crown");
    expect(frame).toContain("Locked.");
    expect(frame).not.toContain("Tribute due");
    expect(frame).not.toContain("demands nothing");
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
    [30, ["> Peasant30", "↑", "↓"], []],
    [1, ["> Peasant1", "↓"], ["↑"]],
  ])(
    "with 40 peasants and number %d selected, the list scrolls to it",
    async (selected, has, lacks) => {
      const crowd = emptyView({
        delegates: Array.from({ length: 40 }, (_, index) => ({
          ...ada,
          id: index + 1,
          name: `Peasant${index + 1}`,
          job: "idle" as const,
        })),
      });

      const frame = await draw([crowd], "", undefined, selected);

      for (const shown of has) expect(frame).toContain(shown);
      for (const gone of lacks) expect(frame).not.toContain(gone);
    },
  );
});
