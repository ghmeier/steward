---
title: "Class refactor merged: Game root with composed managers"
status: closed
tags: [engine, refactor]
branch: main
created: 2026-11-01
updated: 2026-11-01
---
# Class refactor merged: Game root with composed managers

Continues [plan/engine/class-refactor.md](../../plan/engine/class-refactor.md). Merged as PR #1 (`62057db`).

## Context

The engine used to be free functions that took `state` and `tuning` on almost every call. It is now a composed object model: one `Game` root that owns the state and tuning, with one manager per domain holding a back-reference to the game.

## Done

### What we built

- `Game` (`src/core/game.ts`) has three entry points:
  - `Game.create(seed, tuning)` starts a new game: it seeds the random number streams, draws the initial population and sets the first dispute arrival.
  - `Game.fromState(state, tuning)` wraps existing state and draws nothing.
  - `clone()` is `fromState(structuredClone(state))`.
  - `validate()` wraps `assertValidState`.
- Managers on the game: `delegates`, `economy`, `conditions`, `decrees`, `savedDecrees`, `unlocks`, `desk`, `commands`, `projection`, `steps`, `view`. They read state through the game; their arguments are only per-call inputs (a command, an amount, an `AddContext`).
- `Session` (`src/tui/session.ts`) is a class that owns a `Game`. The app, the simulation runner, and the strategy player build a `Game` with `create` or `fromState`.
- Tests live next to their sources. Shared helpers and fixtures stay in `test/` (`helpers.ts`, `tui-helpers.ts`, `fixtures/`, `golden.json`).

### Key files

| File | Role |
| --- | --- |
| `src/core/game.ts` | `Game` root and constructors |
| `src/core/state.ts` | Plain state types, `SCHEMA_VERSION`, `RNG_STREAMS` |
| `src/core/step.ts` | `StepManager`: tick order, including the private promotion check |
| `src/core/desk.ts` | `DeskManager`, plus pure `drawArrivalDelay` and `fillNames` |
| `src/core/realm.ts` | `Job` enum, `JOBS` (includes idle), `WORKING_JOBS` (excludes idle) |
| `src/core/decree.ts` | Pure decree parsing and `policiesFor(petition, tuning)` |
| `src/tui/session.ts` | `Session` class |
| `test/helpers.ts` | `sampleVillage`, `setRoster`, `grantUnlocks`, `setFamineDue`, all taking a `Game` |

### Pull requests

| PR | Description |
| --- | --- |
| #1 | Finish the class refactor: `Game` root, desk and session classes, tests co-located |

## In progress

Nothing.

## Next steps

- The Zod migration (REFINEMENTS item 1) replaces `schema.ts`, and the parsing in `decree.ts`, `validate.ts`, `tuning.ts` and `commands.ts`.

## Gotchas

- `test/golden.json` is the behavior contract. A refactor that changes the hash has a bug; never regenerate it to make a refactor pass.
- Managers import `Game` with `import type` only. `game.ts` imports every manager, so a value import from a manager creates a runtime cycle.
- `GameState` must stay plain JSON data with no class instances in it; saves serialize it directly.
- `GameView.realm.labor` includes `idle`; there is no `realm.idle`.
- `policiesFor` is a pure export because the TUI menus have a view and tuning but no `Game`.
- The core boundary test (`src/core/core-boundary.test.ts`) scans `src/core` for banned globals and skips `*.test.ts` files.
- For any TUI run on macOS, use `STEWARD_SAVE_DIR`, not `XDG_DATA_HOME`.
