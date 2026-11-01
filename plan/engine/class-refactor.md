---
title: Finish the class-based refactor around a composed Game root
status: draft
tags: [engine, refactor]
created: 2026-11-01
updated: 2026-11-01
next_step: Get user approval, then dispatch phase 1 (Game API and source compile)
---
# Finish the class-based refactor around a composed Game root

## Goal

Replace the function-style engine, which threads `state` and `tuning` through every call, with a composed object model. Commit `dd7ed49` on `refactor-classes` started this: a root `GameStateManager` owns the state and tuning, and each domain manager (delegates, economy, decrees, and so on) holds a back-reference to it. This plan finishes that work, makes the branch green, and co-locates the tests with their sources (REFINEMENTS.md item 3).

Behavior must not change. The golden hash in `test/golden.json` is the proof: it must pass without running `bun run golden:update`, and `SCHEMA_VERSION` stays at 8.

## Decisions (2026-11-01, with the user)

- Rename the root `GameStateManager` to `Game`, and its manager fields to full words.
- Convert core plus the stateful edges: desk, promotion, the TUI session, the simulation runner, and save loading own a `Game`. TUI renderers that turn a `GameView` into lines stay as functions.
- Move every test next to the source file it tests, as a separate commit, in this same effort.
- Leave `decree.ts`, `validate.ts`, and `schema.ts` as pure functions; the Zod migration (REFINEMENTS item 1) will rewrite them. `Game` gets a thin `validate()` entry point.

## Starting state of the branch

- Converted: `DelegateManager`, `EconomyManager`, `ConditionManager`, `CommandManager`, `DecreeEngine`, `SavedDecreeManager`, `UnlockManager`, `ProjectionManager`, `StepManager`, `ViewManager`.
- Not converted: `desk.ts` (`settleDispute`, `runDesk`, `shortfall` take `state` and `tuning`), `promotion.ts`, `tui/session.ts`, `runner/sim.ts`, `tui/app.ts`, `save/save.ts`.
- `bun run check` fails: about 40 files have type errors. Most are tests calling removed functions (`createNewGame`, `step`, `runSteps`, `computeView`, `enactDecree`, `apply`) or passing string literals where the new `Job` enum is required.
- Defects in the commit itself:
  - `ViewManager` is never constructed on the root.
  - `clone()` runs the full constructor, which draws peasant names and an arrival delay from the RNG, then discards that state. It works only because the result is overwritten; it is wasteful in `ProjectionManager.flows()`, which clones every frame.
  - No way to build a manager from a loaded save, so `app.ts` and `sim.ts` call `new GameStateManager(seed, tuning).state` and throw the manager away.
  - `unlocks.ts` imports `GameStateManager` as a value, which creates a runtime import cycle with `state.ts`.
  - `EconomyManager` has `PRICE_KEY` and `laborTargets`, which is pure arithmetic with no manager state; that is fine as a method but should not take `population` when it can read it.

## Target shape

```ts
// src/core/game.ts (renamed from state.ts; state types stay exported from here or move to state-types if the cycle demands)
export class Game {
  readonly tuning: Tuning;
  state: GameState;

  readonly delegates: DelegateManager;
  readonly economy: EconomyManager;
  readonly conditions: ConditionManager;
  readonly decrees: DecreeEngine;
  readonly savedDecrees: SavedDecreeManager;
  readonly unlocks: UnlockManager;
  readonly desk: DeskManager;
  readonly commands: CommandManager;
  readonly projection: ProjectionManager;
  readonly steps: StepManager;
  readonly view: ViewManager;

  static create(seed: number, tuning: Tuning): Game;       // new game: seeds RNG streams, initial population
  static fromState(state: GameState, tuning: Tuning): Game; // loaded save or clone; draws nothing
  clone(): Game;                                             // fromState(structuredClone(this.state), this.tuning)
  validate(): void;                                          // wraps assertValidState(this.state)
}
```

The private constructor takes `(state, tuning)` and only wires managers. Field names are a guide; where a name collides with a getter (for example `game.delegates.delegates`), rename the getter (`all`) rather than abbreviating the field.

Managers keep the back-reference pattern from `dd7ed49` (`constructor(private game: Game)`), import `Game` with `import type` only, and read `this.game.state` and `this.game.tuning` through small getters instead of repeating long paths.

## Phases

### Phase 1: Game API, test move, and source compile (one implementer, session-default model)

Branch `refactor-classes-api`, off `refactor-classes`. Two commits:

1. **Move tests** (mechanical, no content edits): `git mv test/<name>.test.ts` next to its source (`src/core/economy.test.ts`, `src/tui/panels.test.ts`, `src/clock.test.ts`, and so on). Tests with no single source (`determinism`, `core-boundary`, `golden.json`) go next to the code they guard, or stay in `test/` with a one-line reason in the commit message. Shared helpers and fixtures (`test/helpers.ts`, `test/tui-helpers.ts`, `test/fixtures/`) stay in `test/`. Update import paths, `scripts/update-golden.ts`, and the determinism test's paths. `core-boundary.test.ts` scans `src/core` for banned globals and must now skip `*.test.ts` files.
2. **Game API**: everything under "Target shape", plus:
   - `DeskManager` in `desk.ts`: `settle(disputeId, optionId, context)`, `run(context)`, `shortfall(option)`, and the private helpers. `drawArrivalDelay`, `templateOf`, and `fillNames` become methods or stay as pure exports only if `ViewManager` and `Game.create` need them without a game; prefer methods.
   - Promotion: fold `checkPromotion` into the manager that owns population milestones (`DelegateManager.promoteIfDue()` or a private `StepManager` phase) and delete `promotion.ts`. No one-method class.
   - `Session` becomes a class owning a `Game` (`session.game`), replacing `createSession`. It keeps the same frame and rejection behavior.
   - `sim.ts`, `app.ts`, and `strategy.ts` build a `Game` with `Game.create` or `Game.fromState(save.state, tuning)` and call `game.steps.runSteps(...)`. `repealStale` runs on load through the game.
   - Save keeps its plain-data contract: `serializeSave` and `writeSaveFile` accept a `Game` (or `game.state`), and `loadGame` still returns the parsed `SaveFile`; the caller wraps it with `Game.fromState`.
   - Fix every `src` type error, including the `Job` enum fallout in `tui/keys.ts`, `tui/help-menu.ts`, `tui/command-line.ts`, `tui/panels.ts`, and `tui/decree-format.ts`.
   - Rewrite `test/helpers.ts` against `Game` (`sampleVillage` returns a `Game`; `setRoster`, `grantUnlocks`, and `setFamineDue` take a `Game`; `rosterOf` uses `Job`).

Acceptance: `bunx tsc --noEmit` reports zero errors under `src/**/*.ts` excluding `*.test.ts`. `bun test src/core/determinism.test.ts` (or wherever it lands) passes with the existing golden hash. Tests elsewhere may still fail; phase 2 fixes them.

### Phase 2: rewrite tests against Game (four implementers in parallel, `sonnet`)

Each branches off `refactor-classes-api` and touches only its own test files, so the branches merge without conflicts. Each rewrites tests to call `Game` and its managers, uses `Job` members, and follows the test conventions in the user's CLAUDE.md (one invariant per test, arrange/act/assert separated by blank lines, positive and negative case paired, no hardcoded ids). Delete tests that only asserted a removed function's signature.

| Branch | Test files (by source) |
| --- | --- |
| `refactor-classes-tests-engine` | state or game, step, economy, delegates, desk, promotion, projection, view, validate, serialize, unlock-gating |
| `refactor-classes-tests-decrees` | decree, decree-engine, commands, saved-decrees, unlocks, conditions |
| `refactor-classes-tests-edges` | session, app, save, sim, strategies, strategy, determinism, `test/fixtures/save-and-die.ts` |
| `refactor-classes-tests-tui` | panels, keys, help-menu, court-menu, menu, command-line, decree-format, starvation-notice |

Acceptance per branch: its files typecheck and pass with `bun test <files>`.

### Phase 3: integrate, refactor pass, and PR

1. Merge phase 1 and the four phase 2 branches into `refactor-classes`. Run `bun run check`; it must pass with the original golden hash.
2. Refactor pass on `refactor-classes` (standard dispatch from the project-lead skill, plus the review patterns below).
3. Play the TUI briefly with `STEWARD_SAVE_DIR` pointed at a scratch directory to confirm a new game starts, ticks, saves, and reloads.
4. One PR from `refactor-classes` to `main`, with commits kept as the reviewable chunks: the user's `dd7ed49`, the test move, the Game API, the test rewrites, and the refactor pass.

## Review patterns

- The golden hash is the behavior contract. Any change to `test/golden.json` is a bug in the refactor, not a reason to regenerate.
- Managers import `Game` with `import type` only.
- No manager method takes `state` or `tuning` as an argument; it reads them from the game. Arguments are the inputs that genuinely vary per call (a command, an amount, a context).
- `structuredClone(state)` plus `Game.fromState` is the only way to copy a game; nothing re-runs `Game.create` to clone.
- Plain data stays plain: `GameState` remains JSON-serializable, with no class instances stored inside it.

## Risks

- Moving tests into `src` puts them inside the `src/core` boundary scan; the scan must exclude test files or it will flag test-only uses of `Math` and `Date`.
- `ProjectionManager.flows()` clones every frame; after the fix, cloning should cost one `structuredClone` and no RNG draws. Worth a quick timing check against `main` if the TUI feels slower.
- Phase 2 implementers depend on the exact phase 1 API. If phase 1 deviates from "Target shape", update this plan before dispatching phase 2.

## Notes and decisions

- 2026-11-01: Plan drafted after reviewing `dd7ed49`. Branch currently fails typecheck in about 40 files.
