---
title: "Next peasant line merged"
status: closed
tags: [mechanics]
created: 2026-10-29
updated: 2026-11-01
---
# Next peasant line merged

## Context

Continues [[plan/mechanics/next-peasant-progress]]. Merged to `main` as c956035; `bun run check` passes with 764 tests.

## Done

- The ledger shows `Next peasant  12.4 / 25 grain`, plus `(~40s)` while grain is being fed. There is no line once the village is full.
- `projectFlows` in `src/core/projection.ts` returns the ledger rates and the grain fed on the next tick from a single clone. `GameView.growth` carries stored, needed, per-second and full.

## Verification

- A probe (`~/.cache/steward-probes/probe-growth.ts`, copy it to the repo root to run) found that summing the shown growth crosses 25 on exactly the tick of each birth, with 0 mismatched ticks.
- A planted bug that dropped the birth correction failed the birth-tick projection test.
- The line was seen in a fresh game in tmux (`Next peasant  0.0 / 25 grain`). The feeding variant was checked only by tests and the probe, not by hand.

## Gotchas

- The estimate uses next tick's feed rate, so it moves a lot across seasons. In the probe the first birth was estimated at 167s from the start of the cycle and arrived at 118s; the second was estimated at 143s and took 434s. If that feels misleading in play, drop the estimate or forecast across seasons.
- `plain` lives in `src/tui/decree-format.ts` but is now a general number formatter used by the panels and help; moving it to `src/tui/format.ts` would be tidier.
