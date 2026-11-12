import { describe, expect, test } from "bun:test";
import { grantUnlocks, rosterOf, setRoster, tuning } from "../../test/helpers";
import { key } from "../../test/tui-helpers";
import { copy } from "../core/copy";
import { type Decree, PETITIONS, policiesFor } from "../core/decree";
import { Game } from "../core/game";
import { Job } from "../core/realm";
import type { Tuning } from "../core/tuning";
import {
  ARCHIVE_PANEL,
  CHAINING_UNLOCK,
  COMPOUND_UNLOCK,
  CONJURING,
  CROWN_CORRESPONDENCE,
  CROWN_PANEL,
  PALETTE_UNLOCK,
  SAVED_DECREES_UNLOCK,
} from "../core/unlocks";
import { lineKey, openLine, parseLine, renderLine } from "./command-line";
import { describePolicy, formatDecree } from "./decree-format";
import type { MenuContext } from "./menu";

type Setup = {
  unlocks?: string[];
  decrees?: Decree[];
  saved?: { name: string; decree: Decree };
  coin?: number;
  idle?: number;
  tuning?: Tuning;
};

const granary: Decree = {
  id: "granary",
  petition: "harvest",
  rules: [],
  otherwise: "sell",
};
const harvest: Decree = { ...granary, id: "harvest" };
const woodDecree: Decree = { ...granary, id: "wood", petition: "wood" };

function contextWith(setup: Setup = {}): MenuContext {
  const using = setup.tuning ?? tuning;
  const game = Game.create(1, using);
  grantUnlocks(game, setup.unlocks ?? []);
  for (const decree of setup.decrees ?? []) game.decrees.enact(decree);
  if (setup.saved !== undefined) {
    grantUnlocks(game, [SAVED_DECREES_UNLOCK]);
    game.savedDecrees.save(setup.saved.name, setup.saved.decree);
  }
  if (setup.coin !== undefined) game.state.posting.resources.coin = setup.coin;
  if (setup.idle !== undefined) setRoster(game, { idle: setup.idle });
  return { view: game.view.compute(), tuning: using };
}

const compound: Setup = { unlocks: [COMPOUND_UNLOCK] };
const chained: Setup = { unlocks: [CHAINING_UNLOCK], decrees: [harvest] };
const archive: Setup = { unlocks: [ARCHIVE_PANEL] };
const crowned: Setup = { unlocks: [CROWN_PANEL] };
const conjuring: Setup = { unlocks: [CONJURING] };
const corresponding: Setup = { unlocks: [CROWN_CORRESPONDENCE] };
const saving: Setup = { saved: { name: "plan", decree: granary } };
const palette: Setup = { unlocks: [PALETTE_UNLOCK], idle: 3 };
const everyVerb: Setup = {
  unlocks: [ARCHIVE_PANEL, PALETTE_UNLOCK, SAVED_DECREES_UNLOCK],
};
const entry = (id: string) => {
  const found = tuning.archive.entries.find((e) => e.id === id);
  if (found === undefined) throw new Error(`no archive entry ${id}`);
  return found;
};
const repeated = (count: number, unit: string, joiner: string) =>
  Array(count).fill(unit).join(joiner);
const { maxRules, maxConditionNodes: maxNodes } = tuning.decrees;
const peasants = rosterOf({ idle: 3 });
const second = peasants[1];
const onlyDependent: Tuning = {
  ...tuning,
  archive: {
    ...tuning.archive,
    entries: tuning.archive.entries.filter((e) => e.requires.length > 0),
  },
};

const ok = (command: object) => ({ command });
const bad = (problem: string) => ({ problem });
const line = copy.commandLine;
const expected = line.expected;
const label = (id: string) => entry(id).label;
const enact = (decree: object) => ok({ type: "enactDecree", decree });
const woodRuleStart = "decree wood sell when ";
const harvestRuleStart = "decree harvest sell when ";

const coinOrNotIdle = {
  kind: "any",
  conditions: [{ quantity: "coin" }, { kind: "not" }],
};
const woodChoseSell = { kind: "chose", decree: "wood", policy: "sell" };
const savedHarvest = {
  id: "harvest",
  rules: [{ when: { quantity: "grain", value: 5 }, policy: "sell" }],
  otherwise: "stockpile",
};

type Outcome = { command?: object; problem?: string };
// biome-ignore format: one row per line keeps the table scannable
const parseRows: [string, Setup, Outcome | null][] = [
	["decree harvest otherwise sell", {}, enact({ id: "harvest", rules: [] })],
	["decree harvest otherwise sell", { decrees: [granary] }, enact({ id: "granary" })],
	[`${harvestRuleStart}grain seasons above 2 otherwise feed`, {}, enact({ rules: [{ when: { quantity: "grainSeasons" } }] })],
	[`${harvestRuleStart}coin above 0.5 otherwise feed`, {}, enact({ rules: [{ when: { value: 0.5 } }] })],
	[`decree harvest ${repeated(maxRules, "sell when coin above 1", ", ")} otherwise feed`, {}, enact({})],
	[`decree harvest ${repeated(maxRules + 1, "sell when coin above 1", ", ")} otherwise feed`, {}, bad(line.tooManyRules({ maxRules: String(maxRules) }))],
	[`${harvestRuleStart}coin above `, {}, null],
	["decree harvest otherwise sell now", {}, bad(line.doesNotBelong({ rest: "now" }))],
	["decree harvest banana", {}, bad(line.notExpected({ word: "banana", expected: expected.policyOrOtherwise }))],
	[`${woodRuleStart}coin above 1 and idle above 2 otherwise stockpile`, compound, enact({ rules: [{ when: { kind: "all" } }] })],
	[`${woodRuleStart}coin above 1 or not idle above 2 otherwise stockpile`, compound, enact({ rules: [{ when: coinOrNotIdle }] })],
	[`${woodRuleStart}coin above 1 and idle above 2 or ore above 3 otherwise stockpile`, compound, bad(line.mixedJoins)],
	[`${woodRuleStart}${repeated(maxNodes, "coin above 1", " and ")} otherwise stockpile`, compound, bad(line.tooManyConditionParts({ maxParts: String(maxNodes) }))],
	[`${woodRuleStart}not not `, compound, bad(line.notRepeated)],
	[`${woodRuleStart}not coin above 1 otherwise stockpile`, {}, bad(line.notExpected({ word: "not", expected: expected.condition }))],
	[`${woodRuleStart}harvest chose sell otherwise stockpile`, { decrees: [harvest] }, bad(line.notExpected({ word: "harvest", expected: expected.condition }))],
	["decree harvest feed when wood chose sell otherwise stockpile", { ...chained, decrees: [woodDecree] }, enact({ rules: [{ when: woodChoseSell }] })],
	["decree harvest feed when wood above 3 otherwise stockpile", { ...chained, decrees: [woodDecree] }, enact({ rules: [{ when: { kind: "compare", quantity: "wood" } }] })],
	["repeal granary", { decrees: [granary] }, ok({ type: "repealDecree", id: "granary" })],
	["repeal harvest ", { decrees: [granary] }, bad(line.notExpected({ word: "harvest", expected: expected.decreeInForce }))],
	["repeal ", {}, bad(line.noDecreesInForce)],
	["save plan decree harvest otherwise sell", {}, bad(line.needsEntry({ verb: "save", label: label(SAVED_DECREES_UNLOCK) }))],
	["buy palette", {}, bad(line.needsArchive({ verb: "buy" }))],
	["buy compound", archive, ok({ type: "buyUnlock", id: COMPOUND_UNLOCK })],
	["buy saved-decrees", archive, bad(line.needsFirst({ label: label(SAVED_DECREES_UNLOCK), missing: label(PALETTE_UNLOCK) }))],
	["buy compound", { unlocks: [ARCHIVE_PANEL, COMPOUND_UNLOCK] }, bad(line.alreadyOwn({ label: label(COMPOUND_UNLOCK) }))],
	["buy ", { unlocks: [ARCHIVE_PANEL, ...tuning.archive.entries.map((e) => e.id)] }, bad(line.ownEverything)],
	["buy ", { ...archive, tuning: onlyDependent }, bad(line.nothingToBuyYet)],
	["save plan decree harvest sell when grain above 5 otherwise stockpile", everyVerb, ok({ type: "saveDecree", name: "plan", decree: savedHarvest })],
	["save Plan! decree", everyVerb, bad(line.invalidName({ word: "Plan!" }))],
	["enact plan", saving, ok({ type: "enactSaved", name: "plan" })],
	["forget plan", saving, ok({ type: "forgetSaved", name: "plan" })],
	["enact ", { unlocks: [SAVED_DECREES_UNLOCK] }, bad(line.noDecreesSaved)],
	["forget plan", { unlocks: [SAVED_DECREES_UNLOCK] }, bad(line.noSavedDecreesToForget)],
	[`assign ${second?.name} mine`, palette, ok({ type: "assignPeasant", peasant: second?.id, job: Job.MINE })],
	["assign x idle", {}, bad(line.needsEntry({ verb: "assign", label: label(PALETTE_UNLOCK) }))],
	["deliver", crowned, ok({ type: "deliver" })],
	["deliver", {}, bad(line.needsCrown)],
	["conjure grain 25", conjuring, ok({ type: "conjure", resource: "grain", amount: 25 })],
	["conjure coin 5", conjuring, ok({ type: "conjure", resource: "coin", amount: 5 })],
	["conjure ore 5", conjuring, bad(line.notExpected({ word: "ore", expected: expected.resourceToConjure }))],
	["conjure grain 25", {}, bad(line.needsConjuring({ verb: "conjure" }))],
	["forge", conjuring, ok({ type: "forge" })],
	["forge", {}, bad(line.needsConjuring({ verb: "forge" }))],
	["back ore", conjuring, ok({ type: "back", resource: "ore" })],
	["back ore", {}, bad(line.needsConjuring({ verb: "back" }))],
	[`${woodRuleStart}owed ore above 0 otherwise stockpile`, {}, bad(line.owedNeedsEntry({ label: label(CROWN_CORRESPONDENCE) }))],
	[`${woodRuleStart}owed ore above 0 otherwise stockpile`, corresponding, enact({ rules: [{ when: { kind: "compare", quantity: "owedOre" } }] })],
	...PETITIONS.flatMap((petition) =>
		policiesFor(petition, tuning).map((policy): [string, Setup, Outcome] => [
			`decree ${petition} otherwise ${policy}`,
			{},
			enact({ petition, otherwise: policy }),
		]),
	),
];

describe("parseLine", () => {
  test.each(parseRows)("%s", (text, setup, outcome) => {
    const result = parseLine(text, contextWith(setup));

    if (outcome?.command === undefined) expect(result.command).toBeNull();
    else expect(result.command).toMatchObject(outcome.command);
    if (outcome?.problem === undefined) expect(result.problem).toBeNull();
    else {
      expect(result.problem).toBe(outcome.problem);
      expect(result.problem).not.toMatch(/\w\[\d+\]/);
      expect(result.suggestions).toEqual([]);
    }
  });

  test("a rule's comma is optional when typing", () => {
    const context = contextWith();
    const rest = "feed when coin above 2 otherwise stockpile";

    const withComma = parseLine(
      `${harvestRuleStart}coin above 5, ${rest}`,
      context,
    );
    const without = parseLine(
      `${harvestRuleStart}coin above 5 ${rest}`,
      context,
    );

    expect(withComma.command).not.toBeNull();
    expect(without.command).toEqual(withComma.command);
  });
});

// biome-ignore format: one row per line keeps the table scannable
const exactRows: [string, Setup, readonly string[]][] = [
	["", {}, ["decree", "repeal"]],
	["", archive, ["decree", "repeal", "buy"]],
	["decree ", {}, PETITIONS],
	["decree w", {}, ["wood"]],
	[`${harvestRuleStart}grain`, {}, ["grain", "grain seasons"]],
	[`${woodRuleStart}harvest `, chained, ["chose"]],
	[`${woodRuleStart}harvest chose `, chained, policiesFor("harvest", tuning)],
	[`decree harvest ${repeated(maxRules, "sell when coin above 1, ", "")}`, {}, ["otherwise"]],
	["repeal ", { decrees: [granary] }, ["granary"]],
	["enact ", saving, ["plan"]],
	["assign ", palette, peasants.map((peasant) => peasant.name)],
	[`assign ${second?.name} `, palette, ["farm", "forest", "mine", "idle"]],
	...PETITIONS.map((petition): [string, Setup, readonly string[]] => [
		`decree ${petition} otherwise `,
		{},
		policiesFor(petition, tuning),
	]),
];
const andRoom = (count: number) =>
  `${woodRuleStart}${repeated(count, "coin above 1", " and ")} `;
// A leading "!" means the word must be withheld.
// biome-ignore format: one row per line keeps the table scannable
const presenceRows: [string, Setup, string[]][] = [
	["", saving, ["forget"]],
	[harvestRuleStart, {}, ["!not"]],
	[harvestRuleStart, compound, ["not"]],
	[`${harvestRuleStart}coin above 1 `, {}, ["!and", "!or"]],
	[`${harvestRuleStart}coin above 1 `, compound, ["and", "or"]],
	[`${harvestRuleStart}coin above 1 and idle above 2 `, compound, ["and", "!or"]],
	[`${harvestRuleStart}grain `, {}, ["above", "below", "grain seasons"]],
	[andRoom(maxNodes - 2), compound, ["and"]],
	[andRoom(maxNodes - 1), compound, ["!and"]],
	[woodRuleStart, { decrees: [harvest] }, ["!harvest"]],
	[woodRuleStart, chained, ["harvest"]],
	[harvestRuleStart, {}, ["!owed ore", "!owed wood", "!owed grain", "!owed coin"]],
	[harvestRuleStart, corresponding, ["owed ore", "owed wood", "owed grain", "owed coin"]],
	["", crowned, ["deliver"]],
	["", {}, ["!deliver"]],
	["", conjuring, ["conjure", "forge", "back"]],
	["", {}, ["!conjure", "!forge", "!back"]],
	["conjure ", conjuring, ["grain", "coin", "!ore", "!wood"]],
	["back ", conjuring, ["grain", "coin", "ore", "wood"]],
	["buy ", archive, ["palette", "!saved-decrees"]],
	["buy ", { unlocks: [ARCHIVE_PANEL, PALETTE_UNLOCK] }, ["saved-decrees"]],
	["buy ", { unlocks: [ARCHIVE_PANEL, COMPOUND_UNLOCK] }, ["chaining", "!compound"]],
];

describe("labor splits", () => {
  const labor = (rest: string) => `decree labor ${rest}`;
  const rulePrefix = labor("farm 60 forest 30 mine 10 when it is winter ");

  test.each<[string, object[]]>([
    [labor("otherwise farm 60 forest 30 mine 10"), []],
    [labor("otherwise mine 1 farm 2"), []],
    [
      `${rulePrefix}otherwise balanced`,
      [{ policy: "farm 60 forest 30 mine 10" }],
    ],
    [
      `${rulePrefix}farm 1 when it is spring otherwise forest 3 mine 1`,
      [{ policy: "farm 60 forest 30 mine 10" }, { policy: "farm 1" }],
    ],
  ])("%s enacts the split as written", (text, rules) => {
    const result = parseLine(text, contextWith());

    expect(result.problem).toBeNull();
    expect(result.command).toMatchObject({
      type: "enactDecree",
      decree: { petition: "labor", rules },
    });
  });

  test("a split in otherwise is stored in a fixed job order", () => {
    const result = parseLine(labor("otherwise mine 1 farm 2"), contextWith());

    expect(result.command).toMatchObject({
      decree: { otherwise: "farm 2 mine 1" },
    });
  });

  test("a preset word alone is still a preset, and a split works with conditions and chaining", () => {
    const preset = parseLine(labor("otherwise farm"), contextWith());
    const chainedSplit = parseLine(
      labor("farm 1 mine 1 when harvest chose sell otherwise farm"),
      contextWith({ ...chained, unlocks: [CHAINING_UNLOCK, COMPOUND_UNLOCK] }),
    );

    expect(preset.command).toMatchObject({ decree: { otherwise: "farm" } });
    expect(chainedSplit.command).toMatchObject({
      decree: { rules: [{ policy: "farm 1 mine 1" }] },
    });
  });

  test.each([
    ["otherwise farm 0 mine 0", copy.laborSplit.allZero],
    ["otherwise farm 1 farm 2", copy.laborSplit.duplicateJob({ job: "farm" })],
    ["otherwise farm 1 wood 2", copy.laborSplit.unknownJob({ job: "wood" })],
    [
      "otherwise farm -1 mine 2",
      copy.laborSplit.badWeight({ job: "farm", text: "-1" }),
    ],
  ])("%s is refused with a reason", (rest, problem) => {
    expect(parseLine(labor(rest), contextWith())).toMatchObject({
      command: null,
      problem,
    });
  });

  test("after a share, the unused jobs are offered alongside the next keyword", () => {
    const texts = (text: string) =>
      parseLine(text, contextWith()).suggestions.map((s) => s.text);

    expect(texts(labor("farm 60 "))).toEqual(
      expect.arrayContaining(["forest", "mine", "when"]),
    );
    expect(texts(labor("farm 60 "))).not.toContain("farm");
    expect(texts(labor("otherwise farm 60 forest 30 "))).toEqual([]);
    expect(texts(labor("farm 60 fo"))).toEqual(["forest"]);
  });

  test("a number is expected after the job, and typing it offers no suggestions", () => {
    const result = parseLine(labor("farm 6"), contextWith());

    expect(result.suggestions).toEqual([]);
    expect(result.command).toBeNull();
  });
});

describe("suggestions", () => {
  test.each(exactRows)(
    "%s offers exactly the expected words",
    (text, setup, expected) => {
      const result = parseLine(text, contextWith(setup)).suggestions;

      expect(result.map((suggestion) => suggestion.text)).toEqual([
        ...expected,
      ]);
    },
  );

  test.each(presenceRows)(
    "%s offers and withholds the expected words",
    (text, setup, words) => {
      const texts = parseLine(text, contextWith(setup)).suggestions.map(
        (s) => s.text,
      );

      for (const word of words) {
        if (word.startsWith("!")) expect(texts).not.toContain(word.slice(1));
        else expect(texts).toContain(word);
      }
    },
  );

  const paletteEntry = entry(PALETTE_UNLOCK);
  const paletteHelp = {
    label: paletteEntry.label,
    cost: String(paletteEntry.cost),
    description: paletteEntry.description,
  };
  test.each<[string, Setup, string, string]>([
    ["decree wood ", {}, "sell", describePolicy("wood", "sell", tuning)],
    [
      "buy ",
      { ...archive, coin: paletteEntry.cost },
      "palette",
      line.archiveEntryHelp(paletteHelp),
    ],
    [
      "buy ",
      { ...archive, coin: paletteEntry.cost - 30 },
      "palette",
      line.archiveEntryShortHelp({ ...paletteHelp, shortfall: "30" }),
    ],
    ["enact ", saving, "plan", formatDecree({ ...granary, id: "plan" })],
  ])("%s describes the suggestion %#", (text, setup, word, description) => {
    const found = parseLine(text, contextWith(setup)).suggestions.find(
      (s) => s.text === word,
    );

    expect(found?.description).toBe(description);
  });
});

describe("lineKey", () => {
  const fresh = contextWith();

  test.each([
    ["decree ", key("w"), "decree w"],
    ["decree", key("space", { sequence: " " }), "decree "],
    ["", key("a", { shift: true, sequence: "A" }), "A"],
    ["", key("a", { shift: true, sequence: "" }), "A"],
    ["", key("a", { sequence: "" }), "a"],
    ["", key("/", { shift: true, sequence: "" }), "?"],
    ["decree w", key("backspace"), "decree "],
    ["decree wo", key("tab"), "decree wood "],
    [
      "decree harvest sell when coin above 1, f",
      key("tab"),
      "decree harvest sell when coin above 1, feed ",
    ],
    ["decree ", key("return"), "decree harvest "],
  ])("typing into %j then %o gives %j", (before, pressed, after) => {
    const result = lineKey(openLine(before), pressed, fresh);

    expect(result.state?.text).toBe(after);
    expect(result.commands).toEqual([]);
  });

  test.each([key("a", { ctrl: true }), key("a", { meta: true }), key("left")])(
    "%o leaves the line unchanged",
    (pressed) => {
      const state = openLine("decree ");

      expect(lineKey(state, pressed, fresh)).toEqual({ state, commands: [] });
    },
  );

  test("escape closes the line without a command", () => {
    expect(lineKey(openLine("decree "), key("escape"), fresh)).toEqual({
      state: null,
      commands: [],
    });
  });

  test("down moves the highlight and tab completes that suggestion; up stops at the top", () => {
    const down = lineKey(openLine("decree "), key("down"), fresh).state;

    const completed = lineKey(down ?? openLine(""), key("tab"), fresh);
    const up = lineKey(openLine("decree "), key("up"), fresh);

    expect(completed.state?.text).toBe(`decree ${PETITIONS[1]} `);
    expect(up.state?.highlight).toBe(0);
  });

  test("enter on a complete line issues one command and closes", () => {
    const result = lineKey(
      openLine("decree harvest otherwise sell"),
      key("return"),
      fresh,
    );

    expect(result.state).toBeNull();
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0]).toMatchObject({ type: "enactDecree" });
  });
});

describe("renderLine", () => {
  const fresh = contextWith();
  const text = (render: { lines: string[] }) => render.lines.join("\n");

  test("shows the text with a cursor and marks the highlighted suggestion", () => {
    const render = renderLine(openLine("decree "), fresh);

    expect(render.title).toBe(line.title);
    expect(render.lines[0]).toBe(": decree _");
    expect(render.lines[1]).toStartWith("> harvest");
    expect(render.lines[2]).toStartWith("  wood");
    expect(render.hints).toBe(line.hints);
  });

  test("shows six suggestions at most and scrolls to keep the highlight visible", () => {
    const shown = (highlight: number) => {
      const { lines } = renderLine({ text: woodRuleStart, highlight }, fresh);
      return lines.slice(1);
    };

    expect(shown(0)).toHaveLength(6);
    expect(shown(7)).toHaveLength(6);
    expect(shown(7).at(-1)).toStartWith(">");
  });

  test("shows fewer suggestions when the caller's budget is smaller, and never more than six", () => {
    const shown = (budget: number) =>
      renderLine(openLine(woodRuleStart), fresh, budget).lines.length - 1;

    expect(shown(2)).toBe(2);
    expect(shown(50)).toBe(6);
  });

  test("shows a problem, or what a number slot expects when nothing can be suggested", () => {
    const problem = parseLine("decree banana", fresh).problem;

    expect(problem).not.toBeNull();
    expect(renderLine(openLine("decree banana"), fresh).lines).toContain(
      `! ${problem}`,
    );
    expect(
      renderLine(openLine(`${harvestRuleStart}coin above `), fresh).lines,
    ).toContain(`  ${line.numberHelp}`);
  });

  test("does not list the decrees in force, because the Decrees panel shows them", () => {
    const active = contextWith({ decrees: [granary] });

    const render = renderLine(openLine("decree "), active);

    expect(text(render)).not.toContain(formatDecree(granary));
  });
});
