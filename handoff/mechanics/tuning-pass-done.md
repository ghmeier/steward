---
title: "Mechanics pass merged: one-peasant start, honest rates, single-job labor"
status: picked-up
tags: [mechanics]
created: 2026-10-29
updated: 2026-11-01
---
# Mechanics pass merged: one-peasant start, honest rates, single-job labor

## Context

Continues [[plan/mechanics/tuning-pass]] (now completed), which answered Garret's feedback after phase 4. All work is on `main`:

| Commit | Step |
| --- | --- |
| de0fcd6 | Single-job labor policies (`farm`, `forest`, `mine`) and described policies in the decree menu and help |
| d6e7bbc | Ledger rates are the real next-tick change, decrees included |
| 45a360b | The village starts with one peasant; `grainPerPeasant` is 25; strategies retuned |

`bun run check` passes on `main` with 756 tests.

## Done

- **Rates.** `projectedRates` in `src/core/projection.ts` runs `runFlows` (the economy and decree phases, extracted from `step`) on a clone at the next tick. `steadyRates` is gone. Desk events and commands are excluded on purpose.
- **Labor.** A labor policy is still a name from `tuning.economy.laborAllocations`, so the save shape is unchanged. `describePolicy` in `src/tui/decree-format.ts` labels every policy in the menus and help.
- **Start.** One peasant, 60 grain. The reference strategy (feed above two grain seasons, otherwise stockpile, everyone farms) has its first birth at tick 1,183 and is promoted at tick 8,011, about 13.4 minutes.
- **Verification.**
  - The lead's rate probe found 4, 603, 712 and 585 mismatched ticks out of 2,400 before the fix, and 0 after, in all four scenarios.
  - A planted off-by-one bug failed three projection tests.
  - Planted tuning regressions (ten starting peasants; 60 grain per birth) failed the shipped-data, golden and first-birth tests.
  - The strategies were rerun on seeds 1, 7 and 99 through the simulator.
  - A fresh game was driven by hand in tmux: one peasant, the seasonal labor decree built through the menu, and the rates checked (+0.2/s farming in spring; 0.0/s while feeding).

## Not verified

- CI has still never run (no remote).
- Nobody has played from one peasant to promotion by hand. A new player who enacts no harvest decree stockpiles and never grows. The help screen explains feeding, but the first two minutes with one peasant may feel empty.
- Disputes can't arrive until there are two peasants, so the desk is idle for about the first two minutes.

## Next steps

1. Garret: playtest a fresh game, and judge the opening pace and whether 25 grain per birth is right. Pacing data is in the plan's Findings table.
2. Still open from phase 4: the trade petition and dispute costs in wood and ore, the growth-store question, and confirming the phase 4 lead decisions.
3. Phase 5: the type-ahead decree builder. It should reuse `describePolicy` for policy labels.

## Gotchas

- `test/helpers.ts` `sampleVillage(seed)` gives the determinism tests a ten-peasant village. Use it, not `createNewGame`, wherever a test needs disputes or several workers, because the shipped data now starts with one peasant.
- `Walker.choose` in the menu tests matches by label prefix. `farm` is a prefix of `farming`, so choose `farm:` with the colon.
- `computeView` clones the state once per frame. That is fine at 40 delegates, but revisit it if the state grows large.
- The probe scripts are in `~/.cache/steward-probes/`. Run them from the repo root.
