import { afterEach, describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { tuning } from "../../test/helpers";
import { barRow, settledFrame } from "../../test/tui-helpers";
import { copy } from "../core/copy";
import { Job, RESOURCES } from "../core/realm";
import {
  CONJURING,
  CROWN_PANEL,
  PALETTE_UNLOCK,
  type UnlockId,
} from "../core/unlocks";
import type { GameView } from "../core/view";
import {
  formatAmount,
  formatGameTime,
  formatRate,
  formatTicks,
  formatTicksRoughly,
} from "./format";
import { type FocusId, panelHintsText } from "./keys";
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

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Matches a line produced by a template that takes one count, whatever the count is. */
function countedLine(template: (args: { count: string }) => string): RegExp {
  const [before = "", after = ""] = template({ count: "\u0000" }).split(
    "\u0000",
  );
  return new RegExp(`${escaped(before)}\\d+${escaped(after)}`);
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
    illusion: null,
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
  ticksLeft: null,
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
      expect(frame).toContain(copy.keys.barHints);
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

  describe("a locked Crown", () => {
    const label = "A squabble over the miller's grain share";
    const desk = [{ ...dispute, label }];
    const size = { width: 100, height: 30 };
    const bottomTitleRow = (frame: string) =>
      frame.split("\n").find((line) => line.includes("(C)ourt")) ?? "";

    test("is not drawn and leaves the bottom row to a wider Court and Decrees", async () => {
      const frame = await draw([emptyView({ lockedPanels: ["crown"], desk })], {
        size,
      });

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
      const frame = await draw(
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

  test("the ledger shows the time, resources in shared columns, then the realm after a blank line", async () => {
    const view = emptyView({
      elapsedSeconds: 185,
      ledger: [
        { resource: "grain", amount: 5, conjured: 0, ratePerSecond: 1 },
        {
          resource: "timber",
          amount: 1234567.8,
          conjured: 0,
          ratePerSecond: -22.5,
        },
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
    const peasants = copy.ledger.peasants({ population: 12, idle: 5 });
    expect(frame).toContain(copy.ledger.time({ time: formatGameTime(185) }));
    expect(endOf("Grain", formatAmount(5))).toBe(
      endOf("Timber", formatAmount(1234567.8)),
    );
    expect(endOf("Grain", formatRate(1))).toBe(
      endOf("Timber", formatRate(-22.5)),
    );
    expect(line(peasants).indexOf(peasants)).toBe(
      line("Grain").indexOf("Grain"),
    );
    expect(row(peasants)).toBe(row("Timber") + 2);
    expect(frame).toContain(copy.ledger.labor({ farm: 4, forest: 2, mine: 1 }));
    expect(frame).toContain(copy.ledger.season({ season: "Summer" }));
  });

  describe("the Ledger once conjuring is owned", () => {
    const grain = tuning.illusion.lot * 4;
    const conjuredView = (books: "clean" | "thin" | "strained" | "rotten") =>
      emptyView({
        unlocks: [CONJURING],
        illusion: { books, room: 100, auditInTicks: null },
        ledger: [
          { resource: "coin", amount: 9, conjured: 0, ratePerSecond: 0 },
          { resource: "grain", amount: grain, conjured: 30, ratePerSecond: 1 },
        ],
      });

    test("shows the conjured share under its row and the books word, and neither before the unlock", async () => {
      const before = emptyView({
        ledger: conjuredView("clean").ledger.map((line) => ({
          ...line,
          conjured: 0,
        })),
      });

      const frame = await draw([conjuredView("strained")]);
      const plainFrame = await draw([before]);

      expect(frame).toContain(formatAmount(grain));
      const conjured = copy.ledger.conjured({ amount: formatAmount(30) });
      expect(frame).toContain(conjured);
      expect(frame).toContain(copy.ledger.books({ books: "strained" }));
      expect(frame.split(conjured)).toHaveLength(2);
      expect(plainFrame).not.toContain(
        copy.ledger.conjured({ amount: formatAmount(0) }),
      );
      for (const books of ["clean", "thin", "strained", "rotten"]) {
        expect(plainFrame).not.toContain(copy.ledger.books({ books }));
      }
    });

    test.each(["clean", "thin", "strained", "rotten"] as const)(
      "names the books %s",
      async (books) => {
        expect(await draw([conjuredView(books)])).toContain(
          copy.ledger.books({ books }),
        );
      },
    );

    test("marks the selected resource and shows its hints only while focused", async () => {
      const view = conjuredView("thin");

      const size = { width: 240, height: 45 };
      const hints = panelHintsText("ledger", 1000);

      const focused = await draw([view], { focus: "ledger", size });
      const unfocused = await draw([view], { size });

      expect(focused).toContain("> Coin");
      expect(focused).not.toContain("> Grain");
      expect(focused).toContain(hints);
      expect(unfocused).not.toContain("> Coin");
      expect(unfocused).not.toContain(hints);
    });
  });

  describe("an entry with a deadline of its own", () => {
    const ticksLeft = 80 * (1000 / tuning.stepMs);

    test("shows its time left in Court and an entry without one shows none", async () => {
      const timed = { ...dispute, id: 2, label: "Counted.", ticksLeft };

      const withDeadline = await draw([emptyView({ desk: [timed] })]);
      const without = await draw([emptyView({ desk: [dispute] })]);

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
    const promotionLabel = copy.ledger.promotionLabel;
    const nextLabel = copy.ledger.nextPeasantLabel;
    const promotion = copy.ledger.promotionProgress({
      population: 14,
      target: 20,
    });
    const progress = copy.ledger.nextPeasantProgress({
      stored: formatAmount(12.4),
      needed: "25",
    });
    const next = copy.ledger.nextPeasantEstimate({
      progress,
      wait: formatGameTime(26),
    });
    expect(column(wide, 0, promotionLabel)).toBe(
      `${promotionLabel}  ${promotion}`,
    );
    expect(column(wide, 0, nextLabel)).toBe(`${nextLabel}  ${next}`);
    expect(column(narrow, 0, promotionLabel)).toBe(promotionLabel);
    expect(column(narrow, 1, promotionLabel)).toBe(promotion);
    expect(column(narrow, 0, nextLabel)).toBe(nextLabel);
    expect(column(narrow, 1, nextLabel)).toContain(progress);
  });

  test("the ledger gives up the time line only when the panel is too short for everything", async () => {
    const view = emptyView({
      ledger: RESOURCES.map((resource) => ({
        resource,
        amount: 1,
        conjured: 0,
        ratePerSecond: 0,
      })),
      growth: growth({}),
    });

    const tall = await draw([view], { size: { width: 160, height: 45 } });
    const short = await draw([view]);

    const time = copy.ledger.time({ time: formatGameTime(0) });
    expect(tall).toContain(time);
    expect(short).not.toContain(time);
    expect(short).toContain(copy.ledger.nextPeasantLabel);
  });

  test("the ledger keeps the time line at 100 by 30 where the real panel has room for it", async () => {
    const view = emptyView({
      ledger: RESOURCES.map((resource) => ({
        resource,
        amount: 1,
        conjured: 0,
        ratePerSecond: 0,
      })),
      growth: growth({ full: true }),
    });

    const frame = await draw([view]);

    expect(frame).toContain(copy.ledger.time({ time: formatGameTime(0) }));
    expect(frame).toContain(copy.ledger.season({ season: "Spring" }));
  });

  test("an update replaces the values of the last view", async () => {
    const grain = (amount: number) =>
      emptyView({
        ledger: [{ resource: "grain", amount, conjured: 0, ratePerSecond: 1 }],
      });

    const frame = await draw([grain(111), grain(222_222)]);

    expect(frame).not.toContain(formatAmount(111));
    expect(frame).toContain(formatAmount(222_222));
  });

  test.each([
    ["the desk", emptyView(), copy.court.deskClear],
    [
      "the roster",
      emptyView({
        realm: realmOf({
          population: 0,
          labor: { farm: 0, forest: 0, mine: 0, idle: 0 },
        }),
      }),
      copy.village.emptyVillage,
    ],
  ])(
    "%s shows a placeholder when it has nothing",
    async (_name, view, words) => {
      const frame = await draw([view], {
        size: { width: 240, height: 30 },
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
    for (const gone of [copy.court.deskClear, copy.village.emptyVillage]) {
      expect(frame).not.toContain(gone);
    }
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

    const frame = await draw([view]);

    expect(frame).toContain("A smith wants ore");
    expect(frame).not.toContain(copy.court.deskClear);
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

    const none = copy.decrees.none;
    expect(frame).toContain(`harvest  ${none}`);
    expect(frame).toMatch(/wood {5}otherwise stockpile/);
    expect(frame).toContain(`ore      ${none}`);
    expect(frame).toContain(`labor    ${none}`);
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

    const alpha = `Alpha  ${copy.village.archiveCost({ cost: "100" })}`;
    expect(unfocused).toContain(alpha);
    expect(unfocused).toContain(`Beta  ${copy.village.archiveOwned}`);
    expect(unfocused).not.toContain("Opens the first door.");
    expect(focused).toContain(`> ${alpha}`);
    expect(focused).toContain("Opens the first door.");
    expect(focused).not.toContain("Opens the second door.");
  });

  test("the focused panel gets a double border and its hints while the others show neither", async () => {
    const view = emptyView({ delegates: [ada] });

    const frame = await draw([view], {
      focus: "peasants",
      size: { width: 200, height: 30 },
    });

    const hints = panelHintsText("peasants", 1000);
    const top = frame.split("\n").find((line) => line.includes("(P)easants"));
    expect(top).toContain("\u2554");
    expect(frame.match(/\u2554/g)?.length).toBe(1);
    expect(frame.split(hints)).toHaveLength(2);
  });

  test("a focused panel too narrow for its full hints shows the bare keys instead", async () => {
    const frame = await draw([emptyView({ delegates: [ada] })], {
      focus: "peasants",
    });

    expect(frame).toContain(panelHintsText("peasants", 0));
    expect(frame).not.toContain(panelHintsText("peasants", 1000));
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
    expect(focused).toContain("  Ada  farm");
    expect(focused).toContain(`> Bram  idle ${copy.village.grudge}`);
    expect(focused).not.toContain("> Ada");
  });

  describe("the Crown panel", () => {
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
      const frame = await draw(
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
      expect(frame).toContain(panelHintsText("crown", 1000));
    });

    test("the panel names the crown's mood in words and never shows the favor number", async () => {
      const frames = await Promise.all(
        (["cold", "neutral", "warm"] as const).map((favor) =>
          draw(
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
      const frame = await draw(
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
    expect(frame).toContain(copy.village.locked);
    expect(frame).not.toContain("Alpha");
  });

  test.each([
    [
      "before promotion",
      { target: 20, promotedAt: 0, promotedAtSeconds: 0 },
      14,
      [copy.ledger.promotionProgress({ population: 14, target: 20 })],
      [copy.ledger.promotedOn({ time: formatGameTime(120) })],
    ],
    [
      "after promotion",
      { target: 20, promotedAt: 1200, promotedAtSeconds: 120 },
      14,
      [copy.ledger.promotedOn({ time: formatGameTime(120) })],
      [copy.ledger.promotionProgress({ population: 14, target: 20 })],
    ],
  ])("the ledger %s", async (_name, promotion, population, has, lacks) => {
    const view = emptyView({ promotion, realm: realmOf({ population }) });

    const frame = await draw([view], { size: { width: 160, height: 30 } });

    for (const shown of has) expect(frame).toContain(shown);
    for (const gone of lacks) expect(frame).not.toContain(gone);
  });

  describe("the next peasant line", () => {
    const progress = copy.ledger.nextPeasantProgress({
      stored: formatAmount(12.4),
      needed: "25",
    });
    const estimate = copy.ledger.nextPeasantEstimate({
      progress,
      wait: formatGameTime(26),
    });

    test("a feeding village shows progress and time", async () => {
      const frame = await draw([emptyView({ growth: growth({}) })], {
        size: { width: 160, height: 45 },
      });

      expect(frame).toContain(estimate);
    });

    test("a village that is not feeding shows progress and no estimate", async () => {
      const frame = await draw([
        emptyView({ growth: growth({ perSecond: 0 }) }),
      ]);

      expect(frame).toContain(progress);
      expect(frame).not.toContain(estimate);
    });

    test("a full village shows no line", async () => {
      const frame = await draw([emptyView({ growth: growth({ full: true }) })]);

      expect(frame).not.toContain(copy.ledger.nextPeasantLabel);
    });
  });

  test.each([
    [29, "> Peasant30", true, true],
    [0, "> Peasant1", false, true],
  ])(
    "with 40 peasants and index %d selected, the list scrolls to it",
    async (selectedIndex, selected, hasAbove, hasBelow) => {
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

      expect(frame).toContain(selected);
      expect(countedLine(copy.village.moreAbove).test(frame)).toBe(hasAbove);
      expect(countedLine(copy.village.moreBelow).test(frame)).toBe(hasBelow);
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
    expect(one).not.toContain(copy.keys.barHints);
    expect(closed).toContain(copy.keys.barHints);
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
