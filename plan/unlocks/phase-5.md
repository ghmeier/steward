---
title: "Steward: Phase 5 implementation plan (command line, unlocks and the Archive)"
status: completed
tags: [phase-5, unlocks]
created: 2026-11-01
updated: 2026-11-01
---
# Steward: Phase 5 implementation plan (command line, unlocks and the Archive)

Phase 5 makes controls a form of progression. A typed command line with a dropdown of valid next words replaces the decree menu, an unlock registry records what the player owns, and a small Archive sells new controls for coin. Builds on [[plan/village/phase-4]] and the mechanics passes after it ([[plan/mechanics/tuning-pass]], [[plan/mechanics/resource-decrees]], [[plan/mechanics/gentler-famine]]).

## What the development plan says

Source: the claude.ai "Steward: Development Plan" doc, build order item 5, and the "Interface" section of the game design doc.

- **Command line, unlocks and the Archive.** Type-ahead decree entry, the command palette, saved decrees, the unlock registry, and a minimal Archive that sells unlocks. Tutorial hooks are a stub: the registry records the first time each control is needed, so the tutorial can be written once the controls stop changing.
- **Exit:** each control appears only once it is bought in the Archive or unlocked through play.
- **Unlock registry (architecture).** One registry records everything the player has unlocked, and the Archive is its main writer. Commands, key bindings, panels, ledger columns and information precision all check the same registry. Level zero is always free.
- **Commands (architecture).** Single-key actions, the type-ahead decree builder and the command palette all produce command objects: one input path. A saved decree is a stored decree definition, not a list of commands; reapplying it is a single command.
- **State layers.** Unlocks and saved decrees live in the career layer, so phase 9's prestige reset keeps them.
- **Game design doc.** Decrees are built with type-ahead: a dropdown of valid options appears as the player types, with autocomplete. Upgrades widen what a decree can express (conditions, chaining) rather than scaling numbers.

## Scope and exit criteria

In scope: the unlock registry and its data file; the Archive (buy with coin); play unlocks that fire when a condition first holds; the tutorial "first needed" stub; gating of compound and chained decree conditions in the core; the type-ahead command line replacing the decree menu; the command palette; saved decrees; key bindings, hints and help filtered by the registry.

Out of scope: information precision levels and ledger-column unlocks (phase 8 sells precision; the registry's ids leave room), batch orders, the crown panel's unlock trigger (phase 8), the tutorial text itself, a holistic UX and layout pass (Garret wants that done as one piece later), moving the court menu onto the command line, balance beyond first prices.

Exit criteria:

1. A fresh game shows no Archive key, no palette key and no saved-decree verbs. The first coin opens the Archive with a one-line notice. Buying an entry makes its control appear in the keys, the hints, the help screen and the command line, and nothing else appears. Checked by hand in tmux and by a TUI test per unlock.
2. In the core, enacting a decree that uses `any`, `all` or `not` is rejected until "Compound conditions" is owned, and `chose` until "Chaining" is owned. A purchase spends exactly its price through `add`, and fails without changing state when coin is short or a prerequisite is missing.
3. Every decree the menu could build in phase 4 can be typed on the command line, and every decree the command line builds prints back as the same text (round trip).
4. A saved decree can be enacted with one command, replacing the active decree for its petition, and survives a save and load.
5. Garret's version 7 save migrates to version 8 with nothing lost, and with the Archive already open because it holds coin.
6. Replaying a recorded log reproduces the same state hash, and `bun run check` passes.

## Lead decisions

Garret picked these on 2026-10-31:

- **The Archive charges coin.** Coin has had no use; Garret's save holds 73,932 coin. This gives sell decrees a purpose.
- **Today's play stays free.** The starting kit is everything a phase 4 player has: selecting and assigning peasants, court, and decree entry with compare and season conditions, up to `maxRules` (4) rules. Garret's own labor decree uses 3 rules, so rule slots are not gated. The Archive sells the command palette, saved decrees, compound conditions (`any`, `all`, `not`) and chaining (`chose`).
- **One command line, several doors.** One type-ahead engine. `d` opens it with `decree ` typed (free). `a` opens it with `buy ` typed (appears when the Archive opens). `:` opens it empty and offers every verb the player owns; that is the command palette (bought).
- **The two deleted tests were restored** (`test/core-boundary.test.ts`, `test/rng.test.ts`, from `git checkout`). The three edited `.claude/skills` files are Garret's and stay uncommitted on main.

Decided by the lead on Garret's behalf (confirm on return):

- **Unlock ids are dotted strings** in four namespaces: `control.*` (keys and verbs), `decree.*` (decree language), `panel.*` (panels) and, from phase 8, `precision.*`. `career.unlocks` keeps its existing shape, `Record<UnlockId, number>`, mapping an id to the tick it was acquired. The starting kit is not recorded; it is level zero.
- **Unlock content lives in `data/archive.json`**, loaded as `tuning.archive`. The core still receives it as an argument.
- **Play unlocks and tutorial hooks are one mechanism:** a data entry with a decree `Condition` (compare or season only). The first step in which the condition holds records the tick. Reusing `Condition` means no new evaluator and no new trigger language.
- **The Archive opens through play** when coin is first above 0. That is the phase's "unlocked through play" control, and it nudges the player toward a sell decree. Garret's save opens it on the first tick after loading.
- **First prices** (coin): palette 100, saved decrees 250 (requires the palette, since its verbs live there), compound conditions 400, chaining 800. Total 1,550, about 23 minutes of a full 40-peasant village (see the spike). Garret will retune in play; they are tuning values.
- **Gating is enforced in the core,** in `enactDecree` and the new commands, so the runner and the player obey the same rules. Pure UI controls (the palette key) are gated in the TUI by reading the view, since the core sees no keys.
- **Decrees already in force are never revoked** by gating. Gating applies only when a decree is enacted or saved, so a save never becomes invalid.
- **`n` (new village) still wipes the career,** unlocks and saved decrees included. Keeping the career across a restart is phase 9's prestige; doing it early would ship a half-designed prestige.
- **The crown panel's lock moves into the registry** as `panel.crown`. Nothing grants it in phase 5.
- **`sampleVillage` in `test/helpers.ts` grants every Archive unlock,** so the existing determinism and replay tests keep exercising compound and chained decrees. Gating tests use `createNewGame`.
- **Schema version 8,** with a migration from 7 that adds the empty `needed` record. All state-shape changes for the phase land in step 1, so later steps never bump the schema.
- **The court stays a menu** for now. Putting `settle` on the command line belongs to the UX pass.
- **Added during step 1:** `src/runner/sim.ts` takes `--grant <ids>` (with `--seed` only) to write unlocks at tick 0, a testing aid. The golden run grants every Archive entry so the command-log fixture still exercises chained decrees.

## Spike (lead, done)

Garret's decree set from his save (feed above 200 grain, sell wood above 100, sell ore above 50, farm in spring to autumn and mine in winter), seed 1, 36,000 ticks: the first coin arrives around tick 16,000 (about 27 minutes), coin is 173 at tick 21,000 with 40 peasants, and income is about 66 coin a minute afterwards (1,818 at tick 36,000). A player who sells wood early sees coin sooner. The strategy file is in the session scratchpad; rebuild it from the save's `posting.decrees` if needed.

## Unlock registry and the Archive (step 1)

`data/archive.json` (new), loaded as `tuning.archive`:

```json
{
	"maxSaved": 12,
	"entries": [
		{ "id": "control.palette", "label": "Command palette", "description": "…", "cost": 100, "requires": [] },
		{ "id": "control.savedDecrees", "label": "Saved decrees", "description": "…", "cost": 250, "requires": ["control.palette"] },
		{ "id": "decree.compound", "label": "Compound conditions", "description": "…", "cost": 400, "requires": [] },
		{ "id": "decree.chaining", "label": "Chaining", "description": "…", "cost": 800, "requires": [] }
	],
	"play": [
		{ "id": "panel.archive", "label": "The Archive", "when": { "kind": "compare", "quantity": "coin", "comparison": "above", "value": 0 } }
	],
	"needs": [
		{ "control": "court", "when": { "kind": "compare", "quantity": "population", "comparison": "above", "value": 1 } },
		{ "control": "archive", "when": { "kind": "compare", "quantity": "coin", "comparison": "above", "value": 0 } }
	]
}
```

Tuning loading rejects duplicate ids across `entries` and `play`, a `requires` naming an unknown id or forming a cycle, a non-positive cost, and any `when` that is not a compare or season condition.

`src/core/unlocks.ts` (new):

```ts
export type UnlockId = string;
export type ArchiveEntry = { id: UnlockId; label: string; description: string; cost: number; requires: UnlockId[] };
export type PlayUnlock = { id: UnlockId; label: string; when: Condition };
export type NeedHook = { control: string; when: Condition };
export type ArchiveTuning = { maxSaved: number; entries: ArchiveEntry[]; play: PlayUnlock[]; needs: NeedHook[] };

export function hasUnlock(state: GameState, id: UnlockId): boolean;
/** Records play unlocks and first-needed ticks whose condition first holds this step, in sorted id order. */
export function runUnlocks(state: GameState, tuning: Tuning): void;
export function buyUnlock(state: GameState, id: UnlockId, tuning: Tuning, context: AddContext): CommandResult;
/** The unlock a decree needs and does not have, or null. Used by enactDecree and, in step 3, saveDecree. */
export function missingDecreeUnlock(state: GameState, decree: Decree, tuning: Tuning): ArchiveEntry | null;
```

- State: `career.needed: Record<string, number>` (control to first tick needed). `career.savedDecrees` becomes `Record<string, Decree>` and the validator checks each value's decree shape the way it checks `posting.decrees`. Schema 8, migration from 7.
- Step order: `runUnlocks` runs after `checkPromotion`.
- Command `buyUnlock { id: string }`, rejected (state unchanged) for an unknown id, an id already owned, a play unlock, a missing prerequisite, the Archive not yet open, or coin below the cost. Coin is spent with `add`.
- `enactDecree` rejects a decree whose conditions use `all`, `any` or `not` without `decree.compound`, or `chose` without `decree.chaining`. The reason names the Archive entry's label.
- View: `unlocks: UnlockId[]` (owned, sorted), `archive: { open: boolean; entries: { id, label, description, cost, owned, affordable, available }[] }` in data order (`available` means every prerequisite is owned), and `lockedPanels` derived from the registry (`crown` unless `panel.crown` is owned).
- Tests: purchase spends the exact cost (assert against the entry's data, not a literal); each rejection case leaves the state hash unchanged; the gating pairs (rejected before, accepted after) for compound and chaining; a play unlock records the first tick its condition held and never changes after; the migration keeps every field of a version 7 save (use a fixture built from a v7 state, not Garret's file); shipped `archive.json` loads.
- The golden hash and the command-log fixture are regenerated once, with the reason in the commit message.

## Type-ahead command line (step 2a, TUI only)

A pure, renderer-free engine in `src/tui/command-line.ts`, and the `d` door. It replaces `src/tui/decree-menu.ts`, which is deleted along with its tests.

```ts
export type Suggestion = { text: string; description: string };
export type LineState = { text: string; highlight: number };
export type LineResult = {
	suggestions: Suggestion[];   // valid next words for the text so far, filtered by the partial word
	command: Command | null;     // the command the text builds, when it is complete and valid
	problem: string | null;      // why the text cannot continue, in plain words
};
export function parseLine(text: string, context: MenuContext): LineResult;
export function lineKey(state: LineState, key: KeyPress, context: MenuContext): { state: LineState | null; commands: Command[] };
/** The text that builds this decree; parseLine(decreeLine(d)) builds d again. */
export function decreeLine(decree: Decree, tuning: Tuning): string;
```

- Grammar for decrees: `decree <petition> [<policy> when <condition>]… otherwise <policy>`, rules separated by `, ` in printed text (the comma is optional when typing). A condition is `<quantity words> above|below <number>` or `it is <season>`. With `decree.compound`: atoms may start with `not`, and atoms join with `and` or `or` (one kind per rule; mixing is a problem message), mapping to `all`, `any` and `not`. With `decree.chaining`: an atom may be `<active decree id> chose <policy>`. Quantity words come from `words()` in `decree-format.ts`, so `grain seasons` is two words; the parser matches the longest choice the remaining text starts with.
- Suggestions only offer what the player owns, so `and`, `or`, `not` and `chose` never appear before they are bought. Policy suggestions carry `describePolicy` text.
- Keys: printable characters append (use the key event's `sequence`; add `sequence` to `KeyPress`), backspace erases, up and down move the highlight, tab completes the highlighted suggestion, enter issues `command` when it is non-null and otherwise completes the highlight, escape closes. While the line is open, game keys are off except Ctrl-C.
- The decree id is the active decree's id for that petition, else the petition name, as the menu did.
- `repeal <active decree id>` moves here from step 3, because deleting the menu would otherwise remove repealing until step 3 lands.
- Rendering: the line and up to 6 suggestions in the overlay the menus use. Plain styling; the UX pass restyles it.
- Tests: the round trip for a set of decrees covering every petition, both condition kinds and, with unlocks granted, every compound and chained form; suggestions exclude locked words and include them once owned; a partial word filters suggestions by prefix; mixing `and` and `or` gives a problem and no command; enter on an incomplete line issues nothing; every policy the phase 4 menu offered is reachable.

## Saved decrees (step 2b, core only, parallel with 2a)

`src/core/saved-decrees.ts` (new):

- `saveDecree { name: string; decree: unknown }`: needs `control.savedDecrees`; the name matches `DECREE_ID_PATTERN`; the decree parses under `tuning.decrees` limits and passes `missingDecreeUnlock`; at most `tuning.archive.maxSaved` (12) saved decrees; saving under an existing name replaces it. The stored decree's `id` is the name.
- `enactSaved { name: string }`: enacts the saved decree for its petition with the active decree's id for that petition (else the petition name), through `enactDecree`, so every enact check applies. Unknown names are rejected.
- `forgetSaved { name: string }`: removes it; unknown names are rejected.
- View: `savedDecrees: Decree[]`, sorted by name.
- Tests: enact replaces the active decree for the petition and keeps its id; a saved decree that chains to a since-repealed decree is rejected at enact time with the enact reason; the cap; gating (rejected without the unlock); survives a save and load.

## Palette, Archive door and gated controls (step 3, after 2a and 2b)

- Keys: `a` opens the line with `buy ` (needs `panel.archive`), `:` opens it empty (needs `control.palette`). `actionForKey` takes the owned unlocks and returns null for a locked key; `KEY_HINTS` and the help screen list only owned controls.
- Verbs on the line: `decree`, `repeal <id>` (always, through either door that reaches them), `buy <entry>` (suggestions show label, cost and description; owned and unavailable entries are not offered), `save <name> decree …`, `enact <saved name>`, `forget <saved name>` (with `control.savedDecrees`), and `assign <peasant name> <job>`. The palette (`:`) offers every verb the player owns.
- Notices: the footer announces a play unlock once ("The Archive opens. Press a.") and a purchase ("Bought Compound conditions."). Announcements are not repeated after a reload, the way promotion is handled.
- Tests: one test per unlock that the key, hint, help line and verbs are absent before and present after; the palette lists exactly the owned verbs; buying through the line issues `buyUnlock`.

## Task order

| Step | Branch | Depends on | Files owned |
| --- | --- | --- | --- |
| 1 registry and Archive | `unlock-registry` | main | `src/core/{unlocks (new),state,commands,decree-engine,step,tuning,validate,view}.ts`, `data/archive.json` (new), `src/save/{content,save}.ts`, `test/helpers.ts`, core tests, fixtures, golden |
| 2a command line | `command-line` | 1 merged | `src/tui/{command-line (new),keys,app,panels,help-menu}.ts`, delete `src/tui/decree-menu.ts`, TUI tests; no `src/core` |
| 2b saved decrees | `saved-decrees` | 1 merged | `src/core/{saved-decrees (new),commands,view}.ts`, core tests; no `src/tui` |
| 3 palette and gating | `palette` | 2a and 2b merged | `src/tui/*`, TUI tests |
| 4 exit check | lead | 3 merged | none: hand play in tmux, Garret's save migration, handoff |

Steps 2a and 2b run in parallel. 2b adds `view.savedDecrees`; 2a must not touch `src/core/view.ts`.

## Verification the lead runs

- Step 1: a strategy whose reactions buy each entry when coin passes its cost, and try a compound decree before and after; check through the runner's trace that coin drops by exactly each price and that `rejectedCommands` holds the early compound decree only. Plant bugs (skip the prerequisite check, gate `not` but not `any`, spend the cost twice) and confirm each fails a test. Migrate a copy of Garret's save and diff every field.
- Step 2a: type every decree in Garret's save by hand in tmux and compare the enacted decree with the original; confirm the dropdown never shows `and` before the purchase.
- Step 3: a fresh game in tmux from one peasant through the first coin, a purchase of each entry, and a saved decree enacted with one command.

## Risks

- **Grammar readability.** The development plan warns the decree language can grow into a programming language. The flat `and`/`or` rule (no parentheses) keeps lines readable and fits `maxConditionDepth` 3; if players need mixed logic, that is a new Archive tier, not a parser change.
- **Text input in OpenTUI.** Printable characters, space and shifted characters arrive differently across terminals (the existing `?` quirk). Step 2a must be driven in tmux, not only tested.
- **Golden churn.** Step 1 changes the state shape, so the golden hash changes once. Any later change to it in this phase is a bug to explain, not a fixture to refresh.
- **Prices are guesses.** They come from one strategy's income. Garret's playtest decides; nothing else depends on the numbers.
- **The palette overlaps the UX pass.** Keep its rendering plain so the later layout work can replace it without touching the engine.

## Progress

| Step | Branch | Status |
| --- | --- | --- |
| 0 coin spike | lead | done: about 66 coin a minute at 40 peasants; first prices set |
| 0 restore tests | lead | done: `core-boundary` and `rng` tests restored, 120 pass |
| 1 registry and Archive | `unlock-registry` | merged 66986d4 (844 tests); reviewer approved, then one round of should-fix items (required ids in the data, the import cycle broken by a new `conditions.ts`, a nesting test that could not fail); the runner bought all four entries in one tick and coin fell by exactly 1,550 plus that tick's income; rejections matched (compound at tick 1, chaining with 50 coin, saved decrees before the palette); the golden run with `--grant` rejects exactly what main rejected; Garret's save migrates with only the schema version changed and the Archive opens a tick later; planted bugs (no prerequisite check, `any` ungated, cost spent twice) each fail tests |
| 2a command line | `command-line` | merged 80d7de3 (911 tests on main); reviewer requested changes once (the decrees in force were no longer shown anywhere, so the line now lists them; core path text in problems; joins offered past the node limit); lead typed Garret's four decrees in tmux on a scratch save and the enacted decrees are identical to his save's; `not` is refused on a fresh game; planted bugs (compound or chaining always offered) fail tests. Incident: the first implementer tmux run used `XDG_DATA_HOME`, which macOS ignores, and rewrote Garret's real save; restored from `save.json.bak` with his consent. Use `STEWARD_SAVE_DIR`. |
| 2b saved decrees | `saved-decrees` | merged 0d456fd (866 tests); reviewer approved, then one round (shared policy and unlock-reason helpers with the enact path, `SAVED_DECREES_UNLOCK` exported, assertions that could not fail); the runner saved two harvest decrees, swapped them by season and kept the active id `granary`, and with no grant every save and enact was refused; planted bugs (kept id dropped, cap off by one, gating skipped on save) each fail a test |
| 3 palette and gating | `palette` | merged 1221fe9 (954 tests); reviewer approved with no leaks found on a fresh game (hints, help topics, suggestions, court and new-game menus), then one round (one `line` door action carrying its prefill, messages when nothing can be bought or enacted, kebab-case buy slugs, `PALETTE_UNLOCK` moved to the core, wording in the Archive data, the Coin help and the new-village warning) |
| 4 exit check | lead | done 2026-11-01 in tmux on scratch saves: a fresh game 15 ticks before its first coin had no `a` or `:` and no hint for them, then showed "The Archive opens. Press a to buy." once and gained `a archive`; on a copy of Garret's save all four entries were bought (coin 73,932 to 72,382, exactly 1,550), the palette offered every verb, `assign` listed peasants by name, and a compound labor decree was saved as `fieldwork` and enacted with one command; Garret's real save checksum unchanged throughout |
