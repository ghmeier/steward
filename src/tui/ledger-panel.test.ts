import { describe, expect, test } from "bun:test";
import { tuning } from "../../test/helpers";
import {
  disposeDrawnPanels,
  drawPanels,
  emptyView,
  growth,
  key,
  realmOf,
} from "../../test/tui-helpers";
import { copy } from "../core/copy";
import { RESOURCES } from "../core/realm";
import { CONJURING } from "../core/unlocks";
import type { GameView } from "../core/view";
import {
  formatAmount,
  formatGameTime,
  formatRate,
  formatTicksRoughly,
} from "./format";
import { keymap, Village } from "./village-panels";

disposeDrawnPanels();

describe("the Ledger panel", () => {
  test("the ledger shows the time, resources in shared columns, then the realm after a blank line", async () => {
    const view = emptyView({
      elapsedSeconds: 185,
      ledger: [
        {
          resource: "grain",
          amount: 5,
          conjured: 0,
          ratePerSecond: 1,
        },
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

    const frame = await drawPanels([view], {
      size: { width: 160, height: 45 },
    });

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

  test("the ledger shows grain eaten on the grain row only while something is eaten", async () => {
    const withEaten = (grainEatenPerSecond: number) =>
      emptyView({
        grainEatenPerSecond,
        ledger: [
          { resource: "grain", amount: 5, conjured: 0, ratePerSecond: -1 },
        ],
      });

    const size = { width: 160, height: 30 };
    const eating = await drawPanels([withEaten(1.5)], { size });
    const idle = await drawPanels([withEaten(0)], { size });

    const eatenText = copy.ledger.eaten({ rate: formatAmount(1.5) });
    const grainRow = eating.split("\n").find((line) => line.includes("Grain"));
    expect(grainRow).toContain(eatenText);
    expect(idle).not.toContain(copy.ledger.eaten({ rate: formatAmount(0) }));
  });

  describe("the Ledger once conjuring is owned", () => {
    const grain = tuning.illusion.lot * 4;
    const conjuredView = (books: "clean" | "thin" | "strained" | "rotten") =>
      emptyView({
        unlocks: [CONJURING],
        illusion: {
          books,
          room: 100,
          debt: {},
          debtIsExact: false,
          auditOnTheRoad: false,
          auditInTicks: null,
        },
        ledger: [
          {
            resource: "coin",
            amount: 9,
            conjured: 0,
            ratePerSecond: 0,
          },
          {
            resource: "grain",
            amount: grain,
            conjured: 30,
            ratePerSecond: 1,
          },
        ],
      });

    test("shows the conjured share under its row and the books word, and neither before the unlock", async () => {
      const before = emptyView({
        ledger: conjuredView("clean").ledger.map((line) => ({
          ...line,
          conjured: 0,
        })),
      });

      const frame = await drawPanels([conjuredView("strained")]);
      const plainFrame = await drawPanels([before]);

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
        expect(await drawPanels([conjuredView(books)])).toContain(
          copy.ledger.books({ books }),
        );
      },
    );

    test("marks the selected resource and shows its hints only while focused", async () => {
      const view = conjuredView("thin");

      const size = { width: 240, height: 45 };
      const hints = keymap.panelHintsText("ledger", 1000);

      const focused = await drawPanels([view], { focus: "ledger", size });
      const unfocused = await drawPanels([view], { size });

      expect(focused).toContain("> Coin");
      expect(focused).not.toContain("> Grain");
      expect(focused).toContain(hints);
      expect(unfocused).not.toContain("> Coin");
      expect(unfocused).not.toContain(hints);
    });
  });

  describe("debt under the Ledger rows", () => {
    const owing = (
      debtIsExact: boolean,
      grain: { owed: number; repayable: number; covered: boolean },
      auditInTicks: number | null = null,
    ) => {
      const view = emptyView({
        unlocks: [CONJURING],
        illusion: {
          books: "thin",
          room: 100,
          debt: { coin: { owed: 0, repayable: 0, covered: true }, grain },
          debtIsExact,
          auditOnTheRoad: auditInTicks !== null,
          auditInTicks,
        },
        ledger: [
          { resource: "grain", amount: 80, conjured: 0, ratePerSecond: 1 },
          { resource: "coin", amount: 9, conjured: 0, ratePerSecond: 0 },
        ],
      });
      return view;
    };
    const covered = { owed: 120, repayable: 120, covered: true };
    const repayKey = keymap.panelHintKey(
      "ledger",
      copy.keys.panelActions.repay,
    );

    test("names what is owed under the resource that owes it, and nothing under one that owes none", async () => {
      const frame = await drawPanels([owing(false, covered)]);

      const owed = copy.ledger.owed({
        figure: copy.illusion.figure({ amount: "120", exact: false }),
      });
      expect(frame).toContain(owed);
      expect(frame.split("(owed")).toHaveLength(2);
      expect(frame).toMatch(/│ {3}\(owed/);
    });

    test("drops the tilde for exact debt and shows the time until auditors arrive", async () => {
      const exact = await drawPanels([
        owing(true, { ...covered, owed: 1234.5 }, 600),
      ]);
      const rough = await drawPanels([owing(false, covered)]);

      expect(exact).toContain(
        copy.ledger.owed({
          figure: copy.illusion.figure({
            amount: formatAmount(1234.5),
            exact: true,
          }),
        }),
      );
      expect(exact).toContain("(owed 1,234.5)");
      expect(exact).toContain(
        copy.ledger.auditDue({
          wait: formatTicksRoughly(600, tuning.stepMs),
        }),
      );
      expect(rough).not.toContain("Auditors due");
    });

    test("tells the selected row what the repay key would do with the real stock", async () => {
      const size = { width: 240, height: 45 };
      const short = { owed: 120, repayable: 50, covered: false };
      const none = { owed: 120, repayable: 0, covered: false };
      const press = (view: GameView) =>
        drawPanels([view], { focus: "ledger", size });

      const all = await press(owing(false, covered));
      const part = await press(owing(false, short));
      const empty = await press(owing(false, none));

      expect(all).toContain(copy.ledger.repayAll({ key: repayKey }));
      expect(part).toContain(
        copy.ledger.repayPart({
          key: repayKey,
          figure: copy.illusion.figure({ amount: "50", exact: false }),
        }),
      );
      expect(empty).toContain(copy.ledger.repayNone({ resource: "grain" }));
    });

    test("shows no repay advice while the Ledger is not focused", async () => {
      const frame = await drawPanels([owing(false, covered)]);

      expect(frame).toContain("(owed");
      expect(frame).not.toContain(copy.ledger.repayAll({ key: repayKey }));
    });
  });

  test("the ledger keeps promotion and next peasant on one line when wide and splits them when narrow", async () => {
    const view = emptyView({
      realm: realmOf({ population: 14 }),
      growth: growth({}),
    });

    const wide = (
      await drawPanels([view], { size: { width: 160, height: 45 } })
    ).split("\n");
    const narrow = (await drawPanels([view])).split("\n");

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

    const tall = await drawPanels([view], { size: { width: 160, height: 45 } });
    const short = await drawPanels([view]);

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

    const frame = await drawPanels([view]);

    expect(frame).toContain(copy.ledger.time({ time: formatGameTime(0) }));
    expect(frame).toContain(copy.ledger.season({ season: "Spring" }));
  });

  test("an update replaces the values of the last view", async () => {
    const grain = (amount: number) =>
      emptyView({
        ledger: [
          {
            resource: "grain",
            amount,
            conjured: 0,
            ratePerSecond: 1,
          },
        ],
      });

    const frame = await drawPanels([grain(111), grain(222_222)]);

    expect(frame).not.toContain(formatAmount(111));
    expect(frame).toContain(formatAmount(222_222));
  });

  test.each([
    ["before promotion", 0, "Reeve", true],
    ["after promotion", 1200, "Steward", false],
  ])(
    "the ledger %s shows the title and village name, and the promotion progress only before",
    async (_name, promotedAt, title, showsProgress) => {
      const view = emptyView({
        promotion: { target: 20, promotedAt },
        title,
        villageName: "Larkhill",
        realm: realmOf({ population: 14 }),
      });
      const progress = copy.ledger.promotionProgress({
        population: 14,
        target: 20,
      });

      const frame = await drawPanels([view], {
        size: { width: 160, height: 30 },
      });

      expect(frame).toContain(
        copy.ledger.title({ title, village: "Larkhill" }),
      );
      expect(frame.includes(progress)).toBe(showsProgress);
    },
  );

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
      const frame = await drawPanels([emptyView({ growth: growth({}) })], {
        size: { width: 160, height: 45 },
      });

      expect(frame).toContain(estimate);
    });

    test("a village that is not feeding shows progress and no estimate", async () => {
      const frame = await drawPanels([
        emptyView({ growth: growth({ perSecond: 0 }) }),
      ]);

      expect(frame).toContain(progress);
      expect(frame).not.toContain(estimate);
    });

    test("a full village shows no line", async () => {
      const frame = await drawPanels([
        emptyView({ growth: growth({ full: true }) }),
      ]);

      expect(frame).not.toContain(copy.ledger.nextPeasantLabel);
    });
  });

  describe("keys", () => {
    const view = emptyView({
      unlocks: [CONJURING],
      ledger: [
        { resource: "coin", amount: 9, conjured: 0, ratePerSecond: 0 },
        { resource: "grain", amount: 5, conjured: 0, ratePerSecond: 0 },
      ],
    });
    const context = { view, tuning };

    test("enter conjures a lot, the repay key pays it back, escape gives up focus and an unowned key falls through", () => {
      const panel = new Village().focusable.ledger;
      panel.enter(context);
      panel.key(key("j"), context);

      const conjure = panel.key(key("enter"), context);
      const repay = panel.key(
        key(keymap.panelHintKey("ledger", copy.keys.panelActions.repay)),
        context,
      );
      const escaped = panel.key(key("escape"), context);
      const other = panel.key(key("z"), context);

      expect(conjure?.commands).toEqual([
        { type: "conjure", resource: "grain", amount: tuning.illusion.lot },
      ]);
      expect(repay?.commands).toEqual([{ type: "back", resource: "grain" }]);
      expect(escaped?.requests).toEqual([{ kind: "unfocus" }]);
      expect(other).toBeNull();
    });
  });
});
