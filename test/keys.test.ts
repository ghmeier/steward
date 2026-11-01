import { describe, expect, test } from "bun:test";
import { ARCHIVE_PANEL, PALETTE_UNLOCK } from "../src/core/unlocks";
import {
  actionForKey,
  hintsText,
  type KeyAction,
  keyHints,
} from "../src/tui/keys";
import { key } from "./tui-helpers";

const everything = [ARCHIVE_PANEL, PALETTE_UNLOCK];

describe("actionForKey", () => {
  const decree: KeyAction = { kind: "line", prefill: "decree " };
  const palette: KeyAction = { kind: "line", prefill: "" };
  const archive: KeyAction = { kind: "line", prefill: "buy " };
  // biome-ignore format: one case per line keeps the table scannable
  const cases: [
		string,
		ReturnType<typeof key>,
		readonly string[],
		KeyAction | null,
	][] = [
		["f assigns farm", key("f"), [], { kind: "assign", job: "farm" }],
		["w assigns forest", key("w"), [], { kind: "assign", job: "forest" }],
		["m assigns mine", key("m"), [], { kind: "assign", job: "mine" }],
		["i assigns idle", key("i"), [], { kind: "assign", job: "idle" }],
		["up moves back", key("up"), [], { kind: "move", delta: -1 }],
		["k moves back", key("k"), [], { kind: "move", delta: -1 }],
		["down moves on", key("down"), [], { kind: "move", delta: 1 }],
		["j moves on", key("j"), [], { kind: "move", delta: 1 }],
		["n asks for a new village", key("n"), [], { kind: "newGame" }],
		["s saves", key("s"), [], { kind: "save" }],
		["q quits", key("q"), [], { kind: "quit" }],
		["Ctrl-C quits", key("c", { ctrl: true }), [], { kind: "quit" }],
		["c holds court with nothing unlocked", key("c"), [], { kind: "court" }],
		["d opens the decree line with nothing unlocked", key("d"), [], decree],
		["? opens help", key("?"), [], { kind: "help" }],
		["shift-slash opens help", key("/", { shift: true }), [], { kind: "help" }],
		["plain slash does nothing", key("/"), [], null],
		["a opens the Archive line when the panel is owned", key("a"), [ARCHIVE_PANEL], archive],
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
    expect(actionForKey(pressed, unlocks)).toEqual(expected);
  });

  test("mutating a returned action does not change later results", () => {
    const first = actionForKey(key("f"), everything);
    if (first?.kind === "assign") first.job = "mine";

    expect(actionForKey(key("f"), everything)).toEqual({
      kind: "assign",
      job: "farm",
    });
  });

  test("every key advertised in the hints is bound", () => {
    const advertised = keyHints(everything).flatMap((hint) =>
      hint.keys.split("/"),
    );

    for (const name of advertised) {
      expect(actionForKey(key(name), everything)).not.toBeNull();
    }
  });
});

test("the hints for every unlock fit a 120-column footer", () => {
  expect(hintsText(everything).length).toBeLessThanOrEqual(120);
});
