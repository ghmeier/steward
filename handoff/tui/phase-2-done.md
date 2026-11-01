---
title: Phase 2 (minimal TUI) merged; CI and Linux still unverified
status: picked-up
tags: [phase-2]
branch: main
created: 2026-10-28
updated: 2026-11-01
---
# Phase 2 (minimal TUI) merged; CI and Linux still unverified

Continues [[plan/tui/phase-2]] and picks up [[handoff/engine/phase-1-review]]. All four phase 2 steps are merged on `main` (ec36403, 39a3210, 5a2b517, 942b3e8). `bun run check` passes on macOS arm64 with 339 tests.

## Done

- `bun run play` opens the ledger, crown, desk and governors panels with a footer. Grain and the in-game clock advance on their own. `+`/`-` change the toy growth rate through the new `adjustToyRate` command, and rejections show in the footer.
- The TUI reads only `computeView` (`src/core/view.ts`), never `GameState`.
- Saves happen on `s`, every 30 seconds, and on every exit path. A corrupt save is refused and left untouched.
- Exit criteria 1 to 5 of the plan hold. Criterion 4 (keys use the same command path as the runner) was checked independently: a session's command log replayed through `bun run sim` reproduced its state hash.

## Not verified

- CI has never run (no remote, no `gh`). Linux x64 rendering and keys are unverified.
- The real app was tested only in tmux on macOS, through scripted key presses and signals, not by a person at a keyboard.

## Next steps

1. Garret: confirm the lead decisions in the phase 2 plan (made while away). The most visible ones: no `@opentui/keymap`, the new `adjustToyRate` command, client constants in `src/tui/` rather than tuning, and empty-state placeholder text in the three content-free panels.
2. Create the GitHub remote and run CI on macOS and Ubuntu (carried over from phase 1).
3. Play it by hand: `STEWARD_SAVE_DIR=$(mktemp -d) bun run play`.
4. Done in the cleanup pass (72f4e6e): the phase 2 review leftovers. Still open: `test/sim.test.ts` leaves a temporary directory behind.
5. Phase 3 (decree engine, headless) is next per the development plan.

## Gotchas

- **Closing the terminal window**: after SIGHUP, no JavaScript timer fires again once the renderer is torn down, because Bun's event loop spins on the dead terminal. The process would burn 100% CPU forever. SIGHUP therefore goes through `app.hangUp()`, which saves synchronously and calls `process.exit` without touching the renderer. Don't route SIGHUP through the async `shutdown()`, and don't trust timeouts in that state. See `docs/spike-opentui.md`.
- `createCliRenderer` and `createTestRenderer` both need `exitOnCtrlC: false`. The real renderer also needs `exitSignals: []`; otherwise OpenTUI's own handlers destroy the renderer before the app saves.
- `canonicalStringify` refuses `null`, and `GameView.crown` is `null`. Compare views with `JSON.stringify`, never pass a view to the canonical serializer.
- When testing the app by hand with tmux, select the bun process with `pgrep -f "^bun src/tui/main.ts"`. A looser pattern also matches the tmux shell, and killing that orphans the app.
- `wt merge` squashes a multi-commit branch into one commit titled "Squash commits from <branch>". Either have implementers make one commit, or reword the squashed commit before anything is pushed.
