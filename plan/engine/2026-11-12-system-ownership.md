---
title: "Let each system own its schemas, view and panel declarations"
status: active
tags: [refactor, modularity]
created: 2026-11-12
updated: 2026-11-12
next_step: PRs 1, 3, 4, 5 dispatched in parallel; PR 2 waits on PR 1
---
# Let each system own its schemas, view and panel declarations

Research: [[research/engine/2026-11-12-coupling]]. Follows [[handoff/promotion/phase-8-done]].

## Goal

Make a change to one system touch that system's files, not a dozen central ones. Today most feature pull requests touch many files. The import graph has no cycles once type-only imports are set aside, so the cause isn't tangled modules. It's about a dozen central lists that every system has to join, several of which restate what the system already knows. In #22 (governors core), 13 of 18 non-test source files only gained an entry in one of those lists.

The measure of success: after this work, adding a field to one system's saved state, a section to one system's tuning, or a line to one system's view touches that system's file (plus `state.ts` and a save upgrade when the save changes), not `validate.ts`, `tuning.ts`, `view.ts` and `test/helpers.ts`. Adding a panel or a notice touches one file and one list entry.

Every PR here is a refactor with no behavior change. `test/golden.json` must not change, and existing tests pass with only import paths updated, unless a test is being moved or split.

## Decisions

Settled with Garret on 2026-11-12:

- The cut is by system and module to minimize coupling, not a rule like one folder per feature. Files stay where they are; what moves is ownership of pieces into the system's existing file.
- Moving state and tuning schemas lands as one mechanical PR, not one per system.
- All seven seams from the research are in scope.
- `career.followers` and `career.needed` stay.
- `src/tui/panels.test.ts` splits into a test file per panel.
- `copy.ts` stays central. The research found it forces no edits elsewhere and has never caused a merge conflict.
- `REFINEMENTS.md` is out of scope.

Left central on purpose (research, "Essential: leave it central"): the step phase order, save upgrades, the command schema and its switch (the replay format), condition quantities, the audit rule across illusion, desk, crown and governors, `game.ts` as the composition root, `VERBS` as one ordered list, and `help-menu.ts` topics. Not doing: a desk-kind plugin interface, per-system command registration, narrower panel parameter types, or breaking up `Game`.

## PRs

```
main ── PR 1 system-schemas ── PR 2 system-views
main ── PR 3 panel-declarations
main ── PR 4 notice-list
main ── PR 5 decree-grammar
```

PRs 1, 3, 4 and 5 run in parallel. PR 2 stacks on PR 1 because both edit the same system files (`crown.ts`, `illusion.ts`, `governors.ts`, `desk.ts`) and their import blocks would conflict. PR 3 and PR 4 both touch `app.ts` and `app.test.ts` lightly; whichever merges second rebases.

### PR 1: `system-schemas` (research seams 1, 2 and 3)

Each system owns its state type, state schema, initial value and tuning schema. The central files only compose them.

- **Shared primitives.** Move the small Zod helpers (`count`, `positiveCount`, `uint32` from `validate.ts:63-65`; `nonNegative`, `positive`, `positiveInteger`, `name`, `textWithPlaceholders`, `repeatIssues` from `tuning.ts`) into one shared module. Reuse `src/core/data.ts` if it fits; otherwise one new `src/core/schema.ts`.
- **State schemas.** Put each slice's Zod schema next to its hand-written type, typed as `z.ZodType<CrownState>` so the type's doc comments stay (the pattern `validate.ts:326` uses for `PostingState`, and `decree.ts` already owns `decreeSchema`). Slices: crown (`crown.ts`), illusion (`illusion.ts`), desk (`desk.ts`), delegates and governors (`delegates.ts`, `governors.ts`), economy (`economy.ts`), labor (`labor.ts`).
- **Initial values.** Every slice gets an initializer next to it, following `emptyCrownState` and `emptyIllusionState`. `game.ts:83-105` stops building the desk, economy and labor slices inline and calls the initializers.
- **`validate.ts` keeps** the plain-data scan, the root composition (see the research's sketch of `posting`), and the refinements that span slices: `rosterIssues` and `tickBoundIssues`. `validateState` keeps its contract, so `validate.test.ts` passes unchanged.
- **Tuning schemas.** Move each section's schema and inferred type next to its system: crown, illusion, governors, desk (into `desk.ts`, or a `desk-tuning.ts` beside it if `desk.ts` grows past readability), economy and village, archive (`unlocks.ts`). Systems stop importing their own tuning type from `tuning.ts`. `tuning.ts` keeps the root composition and the cross-section refinement (`tuning.ts:483-501`).
- **Test tuning from the real files.** Export the data file map from `src/save/content.ts:11-19` and build `fullTuningJson` in `test/helpers.ts` from it, so the seven files are listed once. Rewrite `economyTestTuning` as the real tuning plus overrides of only the sections whose numbers the economy tests compute by hand (`test/helpers.ts:29-160`). Replace the hand-listed posting keys in `src/core/serialize.test.ts:57-76` with a generic key-order reversal.

Acceptance:
- `bun run check` passes, `test/golden.json` is unchanged, and no save upgrade is added (the saved shape doesn't change).
- `validate.ts` and `tuning.ts` mention no field of any single system's slice except in the composition.
- Adding a tuning section is no longer an edit to `test/helpers.ts`.
- The PR description lists, per system, what moved where, so the reviewer can confirm every hunk is a move.

### PR 2: `system-views` (research seam 4, from `system-schemas`)

Each system builds its own view slice.

- Move `crownView`, `illusionView`, `governorViews` and `deskEntries`, with their view types, into methods on the managers (`game.crown.view()` and so on). Precision gating (`view.ts:167-169`, `:241-266`, `:275-286`) moves into the illusion and governors, the herald line fill (`:288-309`) into the crown, and desk entry rendering (`:311-330`) into the desk.
- `ViewManager.compute` becomes a composition of slices plus the lines that truly span systems: the ledger (projection, illusion and the governors' report gap), promotion and growth.
- `GameView` stays one composite type and `MenuContext` stays as is. The interface imports view types from their system files.
- `projection.ts:35-37` reads `posting.delegates` directly; route it through `DelegateManager` if that's a one-line change.

Acceptance: `bun run check` passes, the golden is unchanged, and `view.ts` contains no logic that reads only one system's state.

### PR 3: `panel-declarations` (research seam 5, plus splitting the panel tests)

A panel declares its focus key, its unlock and its hints in one place.

- Give `VillagePanel` (`village-panels.ts:60-81`) three declared fields: focus key, required unlock and hint list. Derive the focus entries of `BINDINGS`, the panel rows of `GLOBAL_HINTS`, the `FOCUS_IDS` order and `PANEL_HINTS` (`keys.ts:19-26`, `:48-62`, `:176-188`, `:191-224`) from the `Village` record (`village-panels.ts:527-537`). Global keys that aren't panels (`:`, `?`, `n`, `s`, `q`, arrows) stay in `keys.ts`.
- Keep `keys.ts` free of a dependency on `village-panels.ts`; do the derivation where the `Village` is built.
- The slot table in `panels.ts:233-244` stays, since placement is a layout decision. Check whether `PanelId` and `lockedPanels` in `view.ts:73`, `:268-273` can read from the same declaration; if that would make the core depend on the interface, leave them.
- `help-menu.ts`'s `keysLines` reads the derived bindings.
- Split `src/tui/panels.test.ts` (1110 lines, conflicted in 5 merges) into a test file per panel that tests the panel object directly through `body(context, size, focused)` and `key(key, context)`. Keep `panels.test.ts` for layout, the bar and focus. Tests move; they don't get rewritten into weaker checks.

Acceptance: `bun run check` passes, rendered frames in the existing tests are unchanged, a panel's key and its hint for that key sit in the same class, and adding a panel is the class plus one `Village` entry plus one slot.

### PR 4: `notice-list` (research seam 6)

Notices become one ordered list with one signature.

- `type Notice = (previous: GameView, next: GameView, frame: { tuning: Tuning; expired: readonly string[] }) => string | null`, and one ordered array whose order is the priority (the last notice wins, as today).
- Rewrite the unlock notice to compare `previous.unlocks` with `next.unlocks` instead of mutating the `knownUnlocks` set. Move the inline promotion notice into the list.
- `app.ts:236-260` loops over the list.

Acceptance: `bun run check` passes, existing notice tests pass with only signature changes, and adding a notice is one file plus one array entry.

### PR 5: `decree-grammar` (research seam 7)

- Move `parseDecreeVerb` and its helpers (`command-line.ts:239-590`) into their own module next to `decree-format.ts`. Export the `Cursor` class for it. `VERBS`, the cursor, the other verbs and rendering stay in `command-line.ts`.
- Pure move. Command line tests that exercise the decree grammar can move with it if they're cleanly separable; otherwise leave them.

Acceptance: `bun run check` passes with no test behavior changes.

## Verification

- Every PR: `bun run check`, and `test/golden.json` unchanged. A golden change in any of these PRs is a bug.
- PR 3 and PR 4 change the interface wiring: one manual run each with `STEWARD_SAVE_DIR=$(mktemp -d) bun run play` to confirm focus keys, hints and notices still work.
- After PR 1 and PR 2 merge, re-run the churn count from the research against a hypothetical: list which files a governors-sized feature would now touch, and record it in Notes.

## Review patterns

- Logic lives in classes; no thin classes or one-off module-level helpers.
- Saved state uses sentinels rather than `null`.
- All player-facing wording stays in `src/core/copy.ts`.
- Plan wording is a spec; its shorthand must not leak into code comments.
- Moves keep existing doc comments on types.
- Small terminals (80x24) are out of scope.
- PRs merge on GitHub with merge commits. For a stack, retarget the next PR to `main` before merging it.

## Risks

- **PR 1 is large.** It's mechanical, but its size makes review slow. The description must list moves per system, and the implementer should avoid any non-move edits beyond the shared primitives and test helpers.
- **Import cycles.** Systems importing a shared schema module, and `tuning.ts` importing every system's tuning schema, could create value-import cycles where there are none today. The implementer checks with the research's graph script (`/private/tmp/claude-501/-Users-ghmeier-git-steward/a0f37dae-545d-45b9-8b1b-d682b40c49a9/scratchpad/graph.ts`, copy it into the scratchpad if it's gone) before and after.
- **Zod inference versus hand-written types.** Typing a schema as `z.ZodType<T>` keeps the hand-written type authoritative; don't switch types to `z.infer`, which would lose the doc comments.

## Progress

- PR 1 `system-schemas`: built at b744bac, 1153 pass, golden unchanged, no value-import cycles before or after (checked with a graph script that skips type-only imports). Shared Zod primitives in new `src/core/schema.ts`; desk tuning in new `src/core/desk-tuning.ts`; `decreeLimitsSchema` moved to `decree.ts`. `career`, `rngStream`, `resources` and `decreeRecord` stay in `validate.ts` as root-level fields. Refactor pass running; PR 2 `system-views` starts from it afterwards.

- PR 5 `decree-grammar`: built at 090c5ee, 1143 pass, golden unchanged. `command-line.ts` 1015 to 464 lines; the grammar is in `decree-grammar.ts` and the parsing cursor in `command-cursor.ts` (keeping it in `command-line.ts` would have made an import cycle); `entryLabel` moved to `menu.ts`. Decree tests stay in `command-line.test.ts` because they share tables with other verbs. #26 open at 090c5ee; the refactor pass found nothing to change. Module-level helpers in `decree-grammar.ts` were left as they were to keep the move pure.
- PR 4 `notice-list`: built at 784ad64, 1144 pass, golden unchanged. `src/tui/notices.ts` holds the `Notice` type and the ordered list; promotion moved to `promotion-notice.ts`; crown and audit notices now take the whole view. Notices are unit-tested only; the manual run only confirmed the TUI boots. #27 open at c425707, 1145 pass: `latestNotice` in `notices.ts` owns the priority rule, a test pins it, and `viewWith` in `test/helpers.ts` builds partial views for notice tests.

## Notes and decisions

- 2026-11-12: Garret: separate systems and modules to minimize coupling, not a fixed per-feature rule. One mechanical PR for state and tuning schemas, all seven seams, keep `career.followers` and `career.needed`, split `panels.test.ts`.
