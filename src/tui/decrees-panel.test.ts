import { describe, expect, test } from "bun:test";
import { tuning } from "../../test/helpers";
import {
  disposeDrawnPanels,
  drawPanels,
  emptyView,
  key,
} from "../../test/tui-helpers";
import { copy } from "../core/copy";
import type { Decree } from "../core/decree";
import { PETITIONS } from "../core/decree";
import { Village } from "./village-panels";

disposeDrawnPanels();

describe("the Decrees panel", () => {
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

    const frame = await drawPanels([view], {
      size: { width: 160, height: 30 },
    });

    const none = copy.decrees.none;
    expect(frame).toContain(`harvest  ${none}`);
    expect(frame).toMatch(/wood {5}otherwise stockpile/);
    expect(frame).toContain(`ore      ${none}`);
    expect(frame).toContain(`labor    ${none}`);
  });

  test("the decrees panel shows a labor split as jobs and shares in a rule and in otherwise", async () => {
    const labor = (rules: Decree["rules"], otherwise: string) =>
      emptyView({
        decrees: [{ id: "workforce", petition: "labor", rules, otherwise }],
      });
    const winter: Decree["rules"] = [
      {
        when: { kind: "season", season: "winter" },
        policy: "forest 1 mine 1",
      },
    ];
    const size = { width: 160, height: 30 };

    const ruleFrame = await drawPanels([labor(winter, "balanced")], { size });
    const otherwiseFrame = await drawPanels(
      [labor([], "farm 60 forest 30 mine 10")],
      { size },
    );

    expect(ruleFrame).toContain("forest 1 · mine 1 when it is winter");
    expect(otherwiseFrame).toContain("otherwise farm 60 · forest 30 · mine 10");
  });

  describe("keys", () => {
    const decree = {
      id: "granary",
      petition: "harvest" as const,
      rules: [],
      otherwise: "stockpile",
    };

    test("enter opens the decree line for the selected petition and the repeal key repeals its decree or says there is none", () => {
      const panel = new Village().focusable.decrees;
      const context = { view: emptyView(), tuning };
      const withDecree = { view: emptyView({ decrees: [decree] }), tuning };
      panel.enter(context);

      const first = panel.key(key("enter"), context);
      panel.key(key("j"), context);
      const second = panel.key(key("enter"), context);

      expect(first?.requests).toEqual([
        { kind: "openLine", text: `decree ${PETITIONS[0]} ` },
      ]);
      expect(second?.requests).toEqual([
        { kind: "openLine", text: `decree ${PETITIONS[1]} ` },
      ]);

      panel.key(key("k"), context);
      const repealed = panel.key(key("x"), withDecree);
      const missing = panel.key(key("x"), context);

      expect(repealed?.commands).toEqual([
        { type: "repealDecree", id: decree.id },
      ]);
      expect(missing?.requests).toEqual([
        {
          kind: "message",
          text: copy.village.noDecreeInForce({ petition: PETITIONS[0] }),
        },
      ]);
    });
  });
});
