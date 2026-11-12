---
title: "Phase 8 merged: governors, crown favor, debt and precision"
status: picked-up
tags: [phase-8]
branch: main
created: 2026-11-12
updated: 2026-11-12
---
# Phase 8 merged: governors, crown favor, debt and precision

## Context

Continues [[plan/promotion/phase-8]] (now completed) and [[handoff/illusion/phase-7-done]]. Research is in [[research/promotion/phase-8]]. Everything is on `main` at aaf3da7, and the save schema is at version 14.

## Done

### What we built

- **Governors are big delegates.** `Delegate` is a union of `Peasant` and `Governor`. A governor runs a village of several peasants on one job, and `assign` moves them the same way it moves a peasant. `DelegateManager.population` sums peasants plus each governor's village. Counts per job are weighted by workers: a governor counts as their village size times their trait's output factor. Labor decrees and famine act on peasants only, so a governor changes job only when you `assign` them by hand.
- **Hiring goes through the Court.** After promotion and while below the cap of 4, a `candidate` desk entry offers a named governor with a job, traits, village size and coin price. Accepting the entry hires them.
- **Traits** (from `data/governors.json`): diligent, skimmer, braggart, hoarder and empire-builder. Each has an output factor and a report factor. The report gap inflates the Ledger's displayed rates but never the stock, so a skimmer's rate visibly outruns the stores.
- **Turnover.** Governors retire when their term ends, can die in any season, and a failed audit dismisses the worst exaggerator (or the newest governor if no one exaggerates). A hoarder hands over their hoard on any departure. Departed governors are kept in `posting.formerStaff`, and the TUI announces each departure.
- **Crown favor** runs from -100 to 100 on `CrownState.favor`. A met demand adds 5, an early one 2 more, and a backed audit 3. A missed demand subtracts 15, a deepened audit 3 and a failed audit 25. Favor falls in three bands at plus or minus 15: cold tightens audits and demand growth, and warm raises the illusion ceiling, the early reward and how often candidates arrive. The Crown panel shows the band word only.
- **The crown keeps a grain reserve.** The crown never takes the last season of real grain (`grainReserveSeasons` in `data/crown.json`), and whatever the reserve leaves undelivered counts as missed. Without the reserve, honest play starved peasants after promotion.
- **Debt and precision.** The Ledger always shows rough debt per resource, rounded up to the nearest 10, and `back` reports what it repaid. The Archive sells *Exact books* for 350 (exact debt, audit timing, and the `debt` decree quantity) and *True reports* for 600 (strips governors' exaggeration and shows each one's gap).
- **Labor shares.** A labor decree can name its own split, for example `labor farm 60 forest 30 mine 10`. The shares are normalized, and the presets stay as named splits.
- **Settling by kind.** `settle {kind, option}` answers the oldest open desk entry of a kind, so strategies can back audits and accept candidates without an id. New decree quantities are `auditors`, `demandTicks`, `candidates` and `debt`.

### Key files

| File | What it does |
| --- | --- |
| `src/core/governors.ts` | `GovernorManager`: hiring, traits, output and report factors, empire-builder growth, terms, death, dismissal, hoards, `formerStaff` |
| `src/core/delegates.ts` | The `Delegate` union, `population`, and worker-weighted counts per job |
| `src/core/crown.ts` | Favor changes, bands, band effects on demands and rewards, the grain reserve |
| `src/core/illusion.ts` | Audit outcomes feed favor, the audit trigger reads the band, failed audits dismiss a governor |
| `src/core/labor-split.ts` | `LaborSplit.fromPolicy` parses presets and custom shares |
| `src/core/desk.ts` | The `candidate` desk kind and settling by kind |
| `src/core/view.ts` | Governors list, report gap on rates, favor band, debt and audit timing by precision |
| `src/tui/roster.ts` | The Peasants panel's rows, with governors listed above peasants |
| `src/tui/governor-notices.ts` | Retired, died and dismissed notices |
| `src/tui/help-menu.ts` | The Governors help topic and the precision part of the Illusion topic |
| `data/governors.json`, `data/crown.json`, `data/desk.json`, `data/archive.json` | All the numbers: traits, terms, cap, prices, favor amounts, bands, candidate templates, precision costs |
| `strategies/borrower.json`, `strategies/governor.json` | Runner strategies for the favor gate and for hiring every candidate |
| `src/runner/strategies.test.ts` | The exit gate: over 10 years on seeds 1, 7 and 42, the borrower beats crown-aware on favor and demands met, and the conjurer ends cold |
| `src/core/favor.test.ts`, `src/core/governors.test.ts`, `src/core/precision.test.ts` | Unit tests for each mechanic |

### PRs

| PR | Branch | What it did |
| --- | --- | --- |
| #20 | `archive-hidden-and-food-eaten` | Hid the locked Archive and showed grain eaten per second (Garret's requests ahead of phase 8) |
| #21 | `crown-favor` | Crown favor, bands, the grain reserve, `settle`, and the favor gate; it also carried #22 |
| #22 | `governors-core` | Governors, population, worker-weighted counts, candidates, turnover (merged into `crown-favor`) |
| #23 | `labor-shares` | Custom labor splits |
| #24 | `debt-and-precision` | Rough debt on the Ledger, repayment messages, Exact books and True reports |
| #25 | `governors-tui` | Governor rows in the Peasants panel, departure notices, the Governors help topic |

### How it was verified

`bun run check` passes on `main` with 1143 tests. The strategies test holds the exit gate on seeds 1, 7 and 42. The governor strategy reaches a population of 57, 68 and 60, against 40 for crown-aware, with no starvation. The governors screens were checked through rendered test frames only. No one has played a governed posting by hand yet.

## In progress

Nothing. Garret is playtesting governors himself.

## Next steps

1. Fold in whatever Garret's governors playtest turns up.
2. `REFINEMENTS.md` (in the repo root, untracked): move tests next to the files they test, and overhaul the village layout. The layout has Ledger and Peasants on the top left, Archive on the top right, and Court and Decrees across the bottom. Each panel's interaction happens inside the panel, Help starts expanded, and the command line moves into the bottom bar.
3. Phase 9: ending a posting.

## Gotchas

- Demands don't scale with population, so governors may make them easy again after promotion. Watch for that in playtests.
- A ceiling per peasant of 40 doubles the room for the conjured-grain-to-coin loan noted in phase 7.
- The borrower repays before any audit arrives, so the runner never exercises settling an audit. Only unit tests cover it.
- Grain base 625 is the lowest at which the strict gate holds. At 600 the conjurer ends with favor 4 on seed 7, which isn't cold.
- `chose` conditions in decrees accept presets only, not custom splits.
- Test fixtures built with `governorOf()` have no traits, so their rows show a gap where the trait words would be. Real governors always have one or two traits.
- Small terminals (80x24) are out of scope. Governor rows wrap there, and that's accepted.
