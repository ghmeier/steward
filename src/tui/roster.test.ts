import { describe, expect, test } from "bun:test";
import {
  addGovernors,
  contextFor,
  governorOf,
  grantUnlocks,
  setRoster,
  tuning,
} from "../../test/helpers";
import { copy } from "../core/copy";
import { Game } from "../core/game";
import { Job } from "../core/realm";
import { TRUE_REPORTS } from "../core/unlocks";
import { formatAmount } from "./format";
import { Roster } from "./roster";
import { PeasantsPanel } from "./village-panels";

const WIDE = { width: 100, height: 20 };
const amountOf = (amount: number | undefined) => formatAmount(amount ?? 0);

function village(peasants: number, unlocks: string[] = []) {
  const game = Game.create(1, tuning);
  setRoster(game, { idle: peasants });
  grantUnlocks(game, unlocks);
  const [braggart, honest] = addGovernors(
    game,
    governorOf({
      village: 10,
      job: Job.MINE,
      traits: ["braggart", "diligent"],
    }),
    governorOf({ village: 6, job: Job.FARM, traits: ["diligent"] }),
  );
  return { game, braggart, honest, view: game.view.compute() };
}

const press = (name: string) => ({
  name,
  ctrl: false,
  meta: false,
  shift: false,
  sequence: name,
});

describe("Roster", () => {
  test("lists governors under their own heading above the peasants", () => {
    const { view, braggart } = village(2);

    const lines = new Roster(view).render(null, WIDE);

    const governorsAt = lines.indexOf(copy.village.governorsHeading);
    const peasantsAt = lines.indexOf(copy.village.peasantsHeading);
    expect(governorsAt).toBe(0);
    expect(peasantsAt).toBeGreaterThan(governorsAt);
    expect(lines[1]).toContain(braggart?.name as string);
    expect(lines[1]).toContain(`village of ${braggart?.village}`);
    expect(lines.slice(peasantsAt + 1)).toHaveLength(2);
  });

  test("shows the reported output and trait words without true reports", () => {
    const { view, braggart } = village(0);
    const row = view.governors[0];

    const text = new Roster(view).render(null, WIDE).join("\n");

    expect(row?.id).toBe(braggart?.id as number);
    expect(text).toContain(
      copy.governors.traitRowList({ traits: braggart?.traits ?? [] }),
    );
    expect(text).toContain(
      copy.village.governorReports({
        rate: amountOf(row?.reportedPerSecond),
        resource: "ore",
      }),
    );
    expect(text).not.toContain("brings in");
  });

  test("shows real output and the gap with true reports, and calls an honest report fair", () => {
    const { view } = village(0, [TRUE_REPORTS]);
    const [braggart, honest] = view.governors;

    const text = new Roster(view).render(null, WIDE).join("\n");

    expect(text).toContain(
      copy.village.governorBringsIn({
        real: amountOf(braggart?.truth?.realPerSecond),
        resource: "ore",
        gap: amountOf(braggart?.truth?.gapPerSecond),
      }),
    );
    expect(text).toContain(
      copy.village.governorHonest({
        real: amountOf(honest?.truth?.realPerSecond),
        resource: "grain",
      }),
    );
    expect(text).not.toContain("reports");
  });

  test("a village without governors has no headings", () => {
    const game = Game.create(1, tuning);
    setRoster(game, { idle: 3 });

    const lines = new Roster(game.view.compute()).render(null, WIDE);

    expect(lines).toHaveLength(3);
    expect(lines.join("\n")).not.toContain(copy.village.governorsHeading);
  });

  test("keeps the selected governor on screen in a panel as small as the smallest terminal gives", () => {
    const { view, honest } = village(20);
    const small = { width: 18, height: 6 };

    const text = new Roster(view).render(honest?.id ?? null, small);

    expect(text.some((line) => line.startsWith(">"))).toBe(true);
    expect(text.join("\n")).toContain(honest?.name as string);
    expect(text.length).toBeLessThanOrEqual(small.height);
    for (const line of text) {
      expect(line.length).toBeLessThanOrEqual(small.width);
    }
  });
});

describe("PeasantsPanel on a governor", () => {
  test("selects governors first and assigns them with the job keys through assignPeasant", () => {
    const { game, view, braggart, honest } = village(2);
    const panel = new PeasantsPanel();
    const context = { view, tuning };
    panel.reset(view);

    const assign = panel.key(press("f"), context);
    panel.key(press("j"), context);
    const second = panel.key(press("w"), context);

    expect(assign?.commands).toEqual([
      { type: "assignPeasant", peasant: braggart?.id as number, job: Job.FARM },
    ]);
    expect(second?.commands).toEqual([
      { type: "assignPeasant", peasant: honest?.id as number, job: Job.FOREST },
    ]);
    const [command] = assign?.commands ?? [];
    if (command === undefined) throw new Error("no command");
    expect(game.commands.apply(command, contextFor(game))).toEqual({
      ok: true,
    });
    expect(braggart?.job).toBe(Job.FARM);
  });

  test("moves on from the last governor to the first peasant", () => {
    const { view, honest } = village(2);
    const panel = new PeasantsPanel();
    const context = { view, tuning };
    panel.reset(view);
    panel.key(press("j"), context);
    panel.key(press("j"), context);

    const step = panel.key(press("m"), context);

    expect(step?.commands).toEqual([
      {
        type: "assignPeasant",
        peasant: view.delegates[0]?.id as number,
        job: Job.MINE,
      },
    ]);
    expect(step?.commands[0]).not.toMatchObject({ peasant: honest?.id });
  });
});
