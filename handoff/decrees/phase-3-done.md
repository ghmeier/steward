---
title: Phase 3 (decree engine, headless) merged; decrees not yet visible in the TUI
status: picked-up
tags: [phase-3]
branch: main
created: 2026-10-29
updated: 2026-11-01
---
# Phase 3 (decree engine, headless) merged; decrees not yet visible in the TUI

## Context

Continues [[plan/decrees/phase-3]] (now completed) and carries the open items of [[handoff/tui/phase-2-done]]. All phase 3 work is on `main`: 0133077 (shared constants), 9fb24ca (decree model), e20359f (economy), 59e5d58 (decree engine), d7ecfd9 (strategies). `bun run check` passes on macOS arm64 with 509 tests.

## Done

- A village economy replaces the toy: four resources, population, farm, forest and mine labor, seasons with a barren winter, starvation, and growth through feeding.
- Decrees are data: ordered `{ when, policy }` rules plus an `otherwise`, over two petitions (`harvest`, `labor`). A decree can test another decree's choice this tick (`chose`), decrees run in dependency order, and a cycle is rejected at enact time with the cycle named. Enact and repeal are commands, so bad decrees are rejected, never crashes. Validation refuses a corrupt decree set at load.
- `bun run sim --strategy strategies/<name>.json [--record <path>]` plays a scripted strategy and reports dead time. Results are in the plan's "Dead-time results" table: the reference set holds a growing village for ten years with no action; a reactive set acts 21 times.
- Keys `f`, `w`, `m` assign idle peasants by hand; the ledger panel shows population, labor and season.
- Every step was checked against an independent Python implementation of the plan (bit-identical state on the golden log, starvation runs, ten-year decree runs, and the recorded strategy log), and each guarding test was shown to fail on a planted bug.

## Not verified

- CI has still never run (no remote). Linux is untested.
- The TUI was driven by hand in tmux only for step 1 (keys, rejection footer, ledger rates, save on quit). Steps 3 and 4 did not touch the TUI.

## Next steps

1. Garret: confirm the phase 3 lead decisions in the plan. The visible ones: the toy is gone, saves from earlier builds are refused (schema version 3), `f`/`w`/`m` replace `+`/`-`, two petitions with one decree each, and strategies live in `strategies/`.
2. Garret: one design point the reviewer raised. At the population cap, grain fed to growth is kept in `growth`, so after a famine drops the village below the cap, births come at once from that store. The plan allows it; decide whether growth should be capped or discarded instead.
3. Phase 4 (village phase) adds a plain decree menu to the TUI. Until then a player cannot see or enact decrees in the app; only the runner can.
4. Carried over from phase 2: create the GitHub remote and run CI on macOS and Ubuntu; `test/sim.test.ts` leaves a temporary directory behind.

## Gotchas

- `step.ts`'s `runSteps` takes an optional `commandSource` callback (used by strategy mode). Its commands run before any log entries for the same tick.
- Strategy reactions are edge-triggered and evaluated after each step; their commands run in the next tick. Strategies may not use `chose`.
- Economy unit tests use `economyTestTuning` in `test/helpers.ts`, a frozen copy of the current numbers, so rebalancing `data/tuning.json` breaks only the golden, determinism and strategy exit tests, which is intended. The strategy exit tests in `test/strategies.test.ts` encode the balance claims ("reference never starves", "naive starves"); a rebalance that breaks them is a design change, not a test to loosen.
- Rejection reasons are not part of state, so changing their wording does not change the golden hash.
- When planting bugs to check a test, do it in a copy of the worktree, not the worktree itself: a reviewer running tests at the same time sees the planted failure.
