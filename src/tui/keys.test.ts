import { describe, expect, test } from "bun:test";
import { key } from "../../test/tui-helpers";
import { copy } from "../core/copy";
import { Job } from "../core/realm";
import { ARCHIVE_PANEL, CONJURING, PALETTE_UNLOCK } from "../core/unlocks";
import {
  FocusRing,
  type KeyAction,
  type PeasantAction,
  peasantActionForKey,
} from "./keys";
import { keymap } from "./village-panels";

const everything = [ARCHIVE_PANEL, PALETTE_UNLOCK, CONJURING];

describe("Keymap.actionForKey", () => {
  const palette: KeyAction = { kind: "line", prefill: "" };
  // biome-ignore format: one case per line keeps the table scannable
  const cases: [
		string,
		ReturnType<typeof key>,
		readonly string[],
		KeyAction | null,
	][] = [
		["p focuses the peasants", key("p"), [], { kind: "focus", panel: "peasants" }],
		["c focuses the court", key("c"), [], { kind: "focus", panel: "court" }],
		["d focuses the decrees", key("d"), [], { kind: "focus", panel: "decrees" }],
		["l focuses the Ledger when conjuring is owned", key("l"), [CONJURING], { kind: "focus", panel: "ledger" }],
		["l does nothing without conjuring", key("l"), [ARCHIVE_PANEL, PALETTE_UNLOCK], null],
		["f does nothing without Peasants focused", key("f"), everything, null],
		["j does nothing without a panel focused", key("j"), everything, null],
		["n asks for a new village", key("n"), [], { kind: "newGame" }],
		["s saves", key("s"), [], { kind: "save" }],
		["q quits", key("q"), [], { kind: "quit" }],
		["Ctrl-C quits", key("c", { ctrl: true }), [], { kind: "quit" }],
		["? opens help", key("?"), [], { kind: "help" }],
		["shift-slash opens help", key("/", { shift: true }), [], { kind: "help" }],
		["plain slash does nothing", key("/"), [], null],
		["a focuses the Archive when the panel is owned", key("a"), [ARCHIVE_PANEL], { kind: "focus", panel: "archive" }],
		["a does nothing without the Archive panel", key("a"), [PALETTE_UNLOCK], null],
		["colon opens the palette when owned", key(":"), [PALETTE_UNLOCK], palette],
		["shift-semicolon opens the palette when owned", key(";", { shift: true }), [PALETTE_UNLOCK], palette],
		["colon does nothing without the palette", key(":"), [ARCHIVE_PANEL], null],
		["plain semicolon does nothing", key(";"), [PALETTE_UNLOCK], null],
		["a held ctrl disables a binding", key("s", { ctrl: true }), everything, null],
		["a held meta disables a binding", key("q", { meta: true }), everything, null],
		["an unbound key does nothing", key("x"), everything, null],
		["an inherited object property does nothing", key("constructor"), everything, null],
	];
  test.each(cases)("%s", (_name, pressed, unlocks, expected) => {
    expect(keymap.actionForKey(pressed, unlocks)).toEqual(expected);
  });

  test("mutating a returned action does not change later results", () => {
    const first = keymap.actionForKey(key("p"), everything);
    if (first?.kind === "focus") first.panel = "court";

    expect(keymap.actionForKey(key("p"), everything)).toEqual({
      kind: "focus",
      panel: "peasants",
    });
  });

  test("every key advertised in the global hints is bound", () => {
    const advertised = keymap
      .keyHints(everything)
      .flatMap((hint) => hint.keys.split("/"));

    for (const name of advertised) {
      expect(keymap.actionForKey(key(name), everything)).not.toBeNull();
    }
  });
});

describe("FocusRing", () => {
  test("the Ledger leads the reading order once conjuring is owned and is absent before", () => {
    const owned = new FocusRing([CONJURING], keymap);
    const unowned = new FocusRing([], keymap);

    expect(owned.target({ kind: "cycle", delta: 1 }, null)).toBe("ledger");
    expect(owned.target({ kind: "cycle", delta: 1 }, "ledger")).toBe(
      "peasants",
    );
    expect(unowned.target({ kind: "cycle", delta: 1 }, null)).toBe("peasants");
    expect(unowned.target({ kind: "cycle", delta: -1 }, "peasants")).toBe(
      "decrees",
    );
  });
});

describe("peasantActionForKey", () => {
  const cases: [string, ReturnType<typeof key>, PeasantAction | null][] = [
    ["f assigns farm", key("f"), { kind: "assign", job: Job.FARM }],
    ["w assigns forest", key("w"), { kind: "assign", job: Job.FOREST }],
    ["m assigns mine", key("m"), { kind: "assign", job: Job.MINE }],
    ["i assigns idle", key("i"), { kind: "assign", job: Job.IDLE }],
    ["up moves back", key("up"), { kind: "move", delta: -1 }],
    ["k moves back", key("k"), { kind: "move", delta: -1 }],
    ["down moves on", key("down"), { kind: "move", delta: 1 }],
    ["j moves on", key("j"), { kind: "move", delta: 1 }],
    ["a held ctrl disables a binding", key("f", { ctrl: true }), null],
    ["an inherited object property does nothing", key("constructor"), null],
  ];
  test.each(cases)("%s", (_name, pressed, expected) => {
    expect(peasantActionForKey(pressed)).toEqual(expected);
  });
});

test("the bottom bar hints stay short enough to share a 60-column line with a message", () => {
  expect(copy.keys.barHints.length).toBeLessThanOrEqual(40);
});
