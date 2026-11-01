---
title: "Steward: mechanics pass (one-peasant start, honest rates, single-job labor)"
status: completed
tags: [mechanics]
created: 2026-10-29
updated: 2026-11-01
---
# Steward: mechanics pass (one-peasant start, honest rates, single-job labor)

## Goal

Garret's feedback after phase 4 (2026-10-28):

1. The village starts with too many peasants. It should start with one.
2. The ledger rates are not always right for the season and the population.
3. Labor decrees are unclear and too rigid. For example, he wants everyone to farm in spring, summer and autumn and mine in winter.

## Findings (lead spike, 2026-10-28)

### Rates

The probe is at `/tmp/steward-rates/probe-rates.ts`. On each tick it compared the ledger rate from `computeView` with the real change on the next step, over 2,400 ticks. `steadyRates` in `src/core/economy.ts` returns production minus upkeep. It is wrong in three ways:

- **Harvest decrees are ignored.** With "sell", grain shows +0.5/s while grain stays flat and coin rises by +0.25/s, yet coin always reads 0.0/s. "Feed" is wrong the same way. This was wrong on 603 and 712 of the 2,400 ticks.
- **The tick is off by one.** The rate uses the season and grudges at `state.tick`, but the next step produces at `state.tick + 1`. So the rate is wrong for one tick at each season change and each grudge expiry.
- **There is no floor at zero.** With empty stores and production below upkeep, grain shows a negative rate, but grain stays at 0 while hunger rises. This was wrong on 585 of 2,400 ticks.

### One-peasant start

The pacing probe is at `/tmp/steward-rates/probe-grid.ts`. With `initialPopulation: 1` and current tuning, `strategies/reference.json` never grows: it ends at 1 peasant after 30 years. With one peasant, 60 grain is ten seasons of stores, so the reference strategy sells every surplus forever. The economy itself is fine. A growth-focused player feeds above two seasons of stores and puts everyone on the farm. That player gets the first birth at 2.5 minutes and promotion at 14.9 minutes at 30 grain per birth. The results at 25 grain per birth were the same for seeds 7 and 99:

| grainPerPeasant | First birth | 5 peasants | Promotion |
| --- | --- | --- | --- |
| 30 | 2.5 min | 6.3 min | 14.9 min |
| 25 | 2.0 min | 5.5 min | 13.4 min |
| 20 | 1.7 min | 5.0 min | 10.2 min |

## Lead decisions

- Garret chose: labor gets single-job policies (`farm`, `forest`, `mine`, which put everyone on that job) next to `balanced` and `farming`. Policies stay names from `tuning.economy.laborAllocations`, so the save shape is unchanged. His example becomes one rule: `mine when it is winter; otherwise farm`.
- Garret chose: the ledger rate is the exact change the next tick makes, with decrees included. One-off events such as dispute costs and expiries are left out.
- Garret chose a retune for a fast early game. Lead picked `grainPerPeasant` 25 (from 30) and kept the starting grain at 60. A perfect grower is promoted in about 13.4 minutes, so a learning player should land at about 15 to 20 minutes.
- The rate is computed by running the economy and decree phases on a `structuredClone` of the state, so it can never drift from `step`. It is not a separate formula. The state is small (at most 40 delegates), so cloning on every view is cheap.
- `naive.json` becomes feed plus farming, because sell plus farming no longer starves from one peasant (it never grows). Measured: grows, then 10 starved.
- `seasonal.json` becomes feed plus farm, stockpiling from autumn to spring through two season reactions, because the old grain thresholds made it stagnate at one peasant.
- The reference strategy is rewritten so it grows from one peasant. It stays the benchmark the promotion test uses.
- Policy labels in the decree menu show what each policy does, so the menu is self-explanatory.

## Steps

| Step | Branch | Depends on | Status |
| --- | --- | --- | --- |
| A. Honest ledger rates | `mech-rates` | none | merged d6e7bbc |
| B. Single-job labor policies and policy labels | `mech-labor` | none | merged de0fcd6 |
| C. One-peasant start and retune | `mech-start` | B | merged 45a360b |

A touches `src/core/` (a new `projection.ts`, plus `view.ts` and `economy.ts`) and its tests. B touches `data/tuning.json` (`laborAllocations` only), `src/tui/decree-format.ts`, `src/tui/decree-menu.ts`, `src/tui/help-menu.ts` and their tests. C touches `data/tuning.json` (`initialPopulation`, `grainPerPeasant`), `strategies/`, the golden file and the tests that assume ten starting peasants.

## Risks

- Many tests read `tuning` from `data/` and assume ten starting peasants or that disputes can arrive. C has to move these to explicit setups, not weaken them.
- With one peasant, disputes cannot arrive, because a dispute needs two parties (`desk.ts:174`). This is fine, since the desk fills once the village grows.
- A new player with no harvest decree stockpiles and never grows. That is the existing design, and the help screen explains feeding.
