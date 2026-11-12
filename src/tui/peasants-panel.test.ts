import { describe, expect, test } from "bun:test";
import {
  addGovernors,
  governorOf,
  setRoster,
  tuning,
} from "../../test/helpers";
import {
  ada,
  countedLine,
  disposeDrawnPanels,
  drawPanels,
  emptyView,
  key,
  realmOf,
} from "../../test/tui-helpers";
import { copy } from "../core/copy";
import { Game } from "../core/game";
import { Job } from "../core/realm";
import type { GameView } from "../core/view";
import { PeasantsPanel } from "./village-panels";

disposeDrawnPanels();

describe("the Peasants panel", () => {
  test("the roster shows a placeholder when it has nothing", async () => {
    const view = emptyView({
      realm: realmOf({
        population: 0,
        labor: { farm: 0, forest: 0, mine: 0, idle: 0 },
      }),
    });

    const frame = await drawPanels([view], {
      size: { width: 240, height: 30 },
    });

    expect(frame).toContain(copy.village.emptyVillage);
  });

  describe("governors in the Peasants panel", () => {
    function governedVillage(): { view: GameView; names: string[] } {
      const game = Game.create(1, tuning);
      setRoster(game, { idle: 12 });
      const governors = addGovernors(
        game,
        governorOf({ job: Job.MINE, traits: ["braggart"] }),
        governorOf({ job: Job.FARM, traits: ["diligent", "hoarder"] }),
        governorOf({ job: Job.FOREST }),
        governorOf({ job: Job.FARM }),
      );
      return {
        view: game.view.compute(),
        names: governors.map((governor) => governor.name),
      };
    }

    test("governors sit under their heading above the peasants, and a selected governor stays on screen at the smallest terminal", async () => {
      const { view, names } = governedVillage();

      const roomy = (
        await drawPanels([view], { size: { width: 160, height: 45 } })
      ).split("\n");
      const cramped = await drawPanels([view], {
        focus: "peasants",
        size: { width: 80, height: 24 },
        selectedIndex: 3,
      });

      const heading = roomy.findIndex((line) =>
        line.includes(copy.village.governorsHeading),
      );
      const first = roomy.findIndex((line) =>
        line.includes(names[0] as string),
      );
      expect(heading).toBeGreaterThan(-1);
      expect(first).toBeGreaterThan(heading);
      expect(cramped).toContain(`> ${names[3]}`);
      expect(cramped).toContain("(P)easants");
    });
  });

  test("peasants show a cursor only while the panel is focused", async () => {
    const view = emptyView({
      delegates: [
        ada,
        { ...ada, id: 4, name: "Bram", job: Job.IDLE, grudgeTicks: 30 },
      ],
    });

    const unfocused = await drawPanels([view], { selectedIndex: 1 });
    const focused = await drawPanels([view], {
      focus: "peasants",
      selectedIndex: 1,
    });

    expect(unfocused).not.toContain("> ");
    expect(focused).toContain("  Ada  farm");
    expect(focused).toContain(`> Bram  idle ${copy.village.grudge}`);
    expect(focused).not.toContain("> Ada");
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

      const frame = await drawPanels([crowd], {
        focus: "peasants",
        selectedIndex,
      });

      expect(frame).toContain(selected);
      expect(countedLine(copy.village.moreAbove).test(frame)).toBe(hasAbove);
      expect(countedLine(copy.village.moreBelow).test(frame)).toBe(hasBelow);
    },
  );

  describe("keys", () => {
    const view = emptyView({ delegates: [ada] });
    const context = { view, tuning };

    test("a job key assigns the selected peasant and asks for a selection when there is none", () => {
      const panel = new PeasantsPanel();
      const empty = { view: emptyView(), tuning };
      panel.reset(view);

      const assigned = panel.key(key("m"), context);
      panel.reset(empty.view);
      const unselected = panel.key(key("m"), empty);

      expect(assigned?.commands).toEqual([
        { type: "assignPeasant", peasant: ada.id, job: Job.MINE },
      ]);
      expect(unselected?.commands).toEqual([]);
      expect(unselected?.requests).toEqual([
        { kind: "message", text: copy.village.noPeasantSelected },
      ]);
    });

    test("escape gives up focus and a key the panel does not own falls through", () => {
      const panel = new PeasantsPanel();

      expect(panel.key(key("escape"), context)?.requests).toEqual([
        { kind: "unfocus" },
      ]);
      expect(panel.key(key("z"), context)).toBeNull();
    });
  });
});
