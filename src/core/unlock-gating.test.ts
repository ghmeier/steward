import { describe, expect, test } from "bun:test";
import { grantUnlocks, topicLines, tuning } from "../../test/helpers";
import { parseLine } from "../tui/command-line";
import {
  actionForKey,
  barCommandsText,
  type KeyPress,
  keyHints,
} from "../tui/keys";
import { copy } from "./copy";
import type { Decree } from "./decree";
import { Game } from "./game";
import {
  ARCHIVE_PANEL,
  CHAINING_UNLOCK,
  COMPOUND_UNLOCK,
  PALETTE_UNLOCK,
  SAVED_DECREES_UNLOCK,
} from "./unlocks";

function key(name: string, modifiers: Partial<KeyPress> = {}): KeyPress {
  return {
    name,
    ctrl: false,
    meta: false,
    shift: false,
    sequence: name,
    ...modifiers,
  };
}

const granary: Decree = {
  id: "granary",
  petition: "harvest",
  rules: [],
  otherwise: "sell",
};

/** Everything the player can see of a control, built from a real state holding exactly these unlocks. */
function surfaces(unlocks: readonly string[]) {
  const game = Game.create(1, tuning);
  grantUnlocks(game, unlocks);
  game.decrees.enact(granary);
  const context = { view: game.view.compute(), tuning };
  const owned = context.view.unlocks;
  const words = (text: string) =>
    parseLine(text, context).suggestions.map((s) => s.text);
  return {
    action: (name: string, modifiers: Partial<KeyPress> = {}) =>
      actionForKey(key(name, modifiers), owned),
    hints: keyHints(owned).map((hint) => hint.label),
    barCommands: barCommandsText(owned),
    keysHelp: topicLines("keys", tuning, unlocks),
    decreesHelp: topicLines("decrees", tuning, unlocks),
    verbs: words(""),
    afterCondition: words("decree wood sell when coin above 5 "),
    startOfCondition: words("decree wood sell when "),
  };
}

type Surfaces = ReturnType<typeof surfaces>;

type Checks = Record<string, boolean>;

// Each row names what an owned unlock reveals; every check must be false without it and true with it.
// biome-ignore format: one row per line keeps the table scannable
const gated: [string, string, (s: Surfaces) => Checks][] = [
	["panel.archive", ARCHIVE_PANEL, (s) => ({
		key: s.action("a")?.kind === "focus", hint: s.hints.includes(copy.keys.hints.archive),
		help: s.keysHelp.some((line) => line.endsWith(copy.keys.hints.archive)), buyVerb: s.verbs.includes("buy"),
	})],
	["control.palette", PALETTE_UNLOCK, (s) => ({
		colon: s.action(":")?.kind === "line", semicolon: s.action(";", { shift: true })?.kind === "line",
		hint: s.hints.includes(copy.keys.hints.commands), bar: s.barCommands === copy.keys.barCommands, help: s.keysHelp.some((line) => line.endsWith(copy.keys.hints.commands)), assignVerb: s.verbs.includes("assign"),
	})],
	["control.savedDecrees", SAVED_DECREES_UNLOCK, (s) => ({
		saveVerb: s.verbs.includes("save"), enactVerb: s.verbs.includes("enact"), help: s.decreesHelp.includes(copy.help.decrees.saved),
	})],
	["decree.compound", COMPOUND_UNLOCK, (s) => ({
		and: s.afterCondition.includes("and"), or: s.afterCondition.includes("or"),
		not: s.startOfCondition.includes("not"), help: s.decreesHelp.includes(copy.help.decrees.compound),
	})],
	["decree.chaining", CHAINING_UNLOCK, (s) => ({
		subject: s.startOfCondition.includes(granary.id), help: s.decreesHelp.includes(copy.help.decrees.chaining),
	})],
];

const all = (checks: Checks, value: boolean) =>
  Object.fromEntries(Object.keys(checks).map((name) => [name, value]));

describe("unlock gating", () => {
  test.each(gated)(
    "%s surfaces appear only once owned",
    (_name, unlock, reveals) => {
      const before = reveals(surfaces([]));
      const after = reveals(surfaces([unlock]));

      expect(before).toEqual(all(before, false));
      expect(after).toEqual(all(after, true));
    },
  );
});
