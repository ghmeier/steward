---
title: "Show progress toward the next peasant"
status: completed
tags: [mechanics]
created: 2026-10-29
updated: 2026-11-01
---
# Show progress toward the next peasant

## Goal

Garret, playtesting (2026-10-29): "I'd like to know how far I am to getting a new peasant."

Births come only from feeding grain: `feedGrain` in `src/core/economy.ts` adds fed grain to `state.posting.economy.growth`, and every `tuning.economy.grainPerPeasant` (25) of growth makes one peasant. The growth store is in the save but nothing shows it.

## Design

The ledger panel gets one line under `Promotion`:

- Feeding: `Next peasant  12.4 / 25 grain  (~40s)`
- Not feeding this tick: `Next peasant  12.4 / 25 grain`, with no estimate
- At `maxPopulation`: no line at all

The estimate is the remaining grain divided by the growth the next tick will add, so it moves with the season and decrees, like the ledger rates. The `~` says it is an estimate.

### Core

- `src/core/projection.ts`: new `projectFlows(state, tuning): { rates: Record<Resource, number>; growthPerTick: number }`. It runs the same clone-and-`runFlows` as today, once. `growthPerTick` is `next.growth - state.growth + grainPerPeasant * births`, where births counts delegates in the clone whose id is not in the original roster. `projectedRates` stays as a thin wrapper returning `.rates`, so existing callers and tests don't change.
- `src/core/view.ts`: `GameView.realm` (or a sibling field, implementer's choice, keep it plain data) gains `growth: { stored: number; needed: number; perSecond: number; full: boolean }`. `perSecond` uses the same tick-to-second conversion as ledger rates. `computeView` calls `projectFlows` once instead of `projectedRates`.

### TUI

- `src/tui/panels.ts`: a `nextPeasantLine(view)` under `promotionLine`. Use `formatAmount` for stored and `formatGameTime` for the estimate. Seconds remaining = `(needed - stored) / perSecond`.

## Lead decisions

- Show it in the ledger rather than the peasants panel: it sits next to `Promotion`, which is the other population progress line.
- Show a time estimate as well as grain, because the question was "how far". The estimate uses the next tick's rate, not a forecast across seasons, matching how the ledger rates work.
- No save shape change.
- Garret chose: no "(not feeding)" suffix, and no line once the village is full.

## Progress

| Step | Branch | Status |
| --- | --- | --- |
| Next peasant line | next-peasant-progress | merged as c956035 |
