---
title: "Systems own their schemas, views and panel declarations"
status: closed
tags: [refactor, modularity]
branch: main
created: 2026-11-12
updated: 2026-11-12
---
# Systems own their schemas, views and panel declarations

## Context

Continues [[plan/engine/2026-11-12-system-ownership]] (completed). Research: [[research/engine/2026-11-12-coupling]]. Everything is on `main` at 1dfc2c9. `bun run check` passes with 1161 tests, and `test/golden.json` didn't change in any of these pull requests.

Garret noticed that feature pull requests touched many files. The research found the modules weren't tangled: there are no value-import cycles. The spread came from about a dozen central lists that every system had to join, several of which restated what the system already knew. This work moved each system's pieces into the system's own file, so the central files now only combine them.

## Done

### What we built

- **Each system owns its state and tuning schemas.** The Zod schema for each state slice sits next to its hand-written type, typed as `z.ZodType<T>`, so the type stays authoritative and keeps its doc comments. Each system also owns its starting value (`emptyCrownState`, `emptyEconomyState`, `initialDeskState` and so on) and its tuning schema (`crownTuningSchema` and so on). `validate.ts` keeps the plain-data scan, the root composition and the checks that span slices (`rosterIssues`, `tickBoundIssues`). `tuning.ts` is down to the root composition and one cross-section check.
- **Each system builds its own view slice.** Each manager has a `view()` method (`GovernorManager` also has `formerView()`), and the view types live in the system files. `view.ts` keeps only the parts that read several systems: the ledger, the realm block, the archive entries, promotion and growth.
- **Panels declare themselves.** Each panel class has a static `keys` holding its id, focus key, unlock, focus label and hints. A `PANELS` record of the classes, checked with `satisfies Record<FocusId, ...>`, builds the `Keymap` in `keys.ts`, which replaced four hand-kept tables. A panel's key handling and its hint now sit in the same class.
- **Notices are one ordered list.** `src/tui/notices.ts` holds the `Notice` type and the list, and `latestNotice` applies the rule that the last notice to return text wins.
- **The decree grammar has its own module.** `command-line.ts` went from 1015 lines to 464.
- **Tests follow the code.** The test tuning is read from the same data file list the game uses, so a new tuning section doesn't touch `test/helpers.ts`. `panels.test.ts` went from 1110 lines to about 300, with one test file per panel.

Central file sizes before and after: `view.ts` 337 to 147, `tuning.ts` 515 to 50, `validate.ts` 386 to 258, `command-line.ts` 1015 to 464, `panels.test.ts` 1110 to 303.

### What a governors-sized feature touches now

New logic goes in the system's own file: its state type and schema, starting value, tuning schema, manager and `view()`. Plus its tests and its data file. The central files still get touched, but only by a line of wiring each, not by logic:

- `state.ts` and a save upgrade in `save.ts`, when the saved shape changes. This is essential.
- One line each in `validate.ts`, `tuning.ts`, `game.ts`, `view.ts`, and the data file map in `src/save/content.ts`.
- Its wording in `src/core/copy.ts`, a help topic in `help-menu.ts`, and a notice file with one entry in `notices.ts`, when it has them.
- For a new panel, five compiler-checked edits: a `FocusId` member, the class, a `PANELS` entry, a `Village` entry and a layout slot.

### Key files

| File | What it does |
| --- | --- |
| `src/core/schema.ts` | Shared Zod helpers (`count`, `positive`, `textWithPlaceholders` and others) |
| `src/core/desk-tuning.ts` | The desk's tuning schema and types, kept apart from `desk.ts` for size |
| `src/core/validate.ts`, `src/core/tuning.ts` | Root composition of state and tuning, plus the checks that span systems |
| `src/core/view.ts` | Composes the view slices, plus the parts that read several systems |
| `src/save/content.ts` | `TUNING_SECTION_FILES` and `readTuningJson`, the single list of data files |
| `src/tui/keys.ts` | The `Keymap` class, plus the global keys that aren't panels |
| `src/tui/village-panels.ts` | Panel classes with their static `keys`, `PANELS`, `Village`, and the exported `keymap` |
| `src/tui/notices.ts` | The `Notice` type, the ordered list and `latestNotice` |
| `src/tui/decree-grammar.ts`, `src/tui/command-cursor.ts` | The decree parser and the shared parsing cursor |

### PRs

| PR | Branch | What it did |
| --- | --- | --- |
| #26 | `decree-grammar` | Moved the decree grammar out of the command line |
| #27 | `notice-list` | Made notices one ordered list with one signature |
| #28 | `system-schemas` | Each system owns its state schema, starting value and tuning schema, and the test tuning comes from the data files; it also carried #30 |
| #29 | `panel-declarations` | Panels declare their keys, unlocks and hints, and the panel tests split per panel |
| #30 | `system-views` | Each system builds its own view slice (merged into `system-schemas`) |

## In progress

Nothing.

## Next steps

None from this plan. Optional follow-ups if they become worth it:
- `decree-grammar.ts` still has module-level helpers (`policyChoices`, `nodeCount`, `combine`, `plainReason`, `conditionLimitProblem`). They were left alone to keep #26 a pure move.
- `projection.ts:35-37` reads `posting.delegates` directly. Routing it through `DelegateManager` would change which delegates it counts, so it needs a deliberate decision.
- `GovernorManager.view()` has a per-second conversion that `view.ts` repeats three times.

## Gotchas

- Keep state types hand-written and type their schemas as `z.ZodType<T>`. Switching to `z.infer` would lose the doc comments.
- The illusion's state schema uses a plain `z.number().min(0)` rather than the shared `nonNegative`, because `nonNegative` normalizes zero and would change validation.
- `career`, the random number streams, `resources` and `decreeRecord` stay in `validate.ts` as top-level state rather than any one system's slice.
- `FocusId` is a hand-written union in `keys.ts`. Deriving it would make `keys.ts` depend on `village-panels.ts`, or make the keymap, focus ring and `app.ts` generic.
- `PanelId` (the core's list of lockable panels) lives in `src/core/unlocks.ts` and is separate from the interface's `FocusId` on purpose, so the core doesn't depend on the interface.
- `fullTuningJson` in `test/helpers.ts` is cast `as Tuning`. That's safe because `game.test.ts` checks that the shipped data parses to itself.
- The research's import-graph script was a scratch file and is gone after this session. The check it ran: no value-import cycles in `src/`, ignoring `import type`.
- Small terminals (80x24) are out of scope for the interface.
