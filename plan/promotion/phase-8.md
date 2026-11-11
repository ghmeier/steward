---
title: "Phase 8: governors, crown favor and Archive precision"
status: active
tags: [phase-8]
created: 2026-11-11
updated: 2026-11-11
last_pr: 24
next_step: Garret reviews #21 (with governors), #23 labor shares and #24 debt and precision; 3c governors-tui in progress from debt-and-precision
---
# Phase 8: governors, crown favor and Archive precision

Research: [[research/promotion/phase-8]]. Continues [[handoff/illusion/phase-7-done]]. Sources: the development plan (build order item 8) and the game design doc's Progression, Governors, Favor and politics, and Resources and illusion sections. Neither gives numbers; every number below is a first guess in a data file.

## Goal

After promotion the game changes shape. The player stops growing a village one peasant at a time and starts taking on governors, each a named character running a village on one job. Governors have economic traits, some of which inflate what they report, and they come and go. The crown keeps a favor score from how its demands and audits went, and that score changes how hard the crown leans. The Archive sells precision that shows the true debt and strips governors' exaggeration.

Exit (from the development plan): a posting plays end to end, and in the runner illusion pays off only when the strategy repays it. "End to end" here means from the first peasant, through promotion, into a governed posting that runs for several game years. Ending a posting is phase 9.

## Decisions

Settled with Garret on 2026-11-11:

- **Governors are big delegates.** A governor is a delegate of kind `governor` who runs a village of several peasants and works one job, using the same `assign` verb and the same grudges. Each governor's village counts toward population.
- **Labor decrees and famine act on peasants only.** A decree's shares divide the peasant count and move only peasants, so a governor changes job only by hand with `assign`. Famine never takes a governor or shrinks a village. (Decided after the governors implementer found that moving a governor shifts a whole village and makes a decree oscillate.)
- **One generic by-kind desk command.** `crown-favor` adds a command that answers the oldest open desk entry of a kind, which strategies use for audits. `governors-core` rebases onto it to accept candidates.
- **Crown favor only.** Lords and citizenry wait until there are mechanics to drive them.
- **Precision covers debt and governor truth.** The `debt` decree quantity moves behind the first precision upgrade.

Proposed here, open to change at approval:

- **Population becomes a derived figure.** `DelegateManager.population` sums one per peasant and each governor's village size. Every reader of `delegates.length` (the view, the illusion ceiling, promotion, crown scaling) moves to it. `maxPopulation` keeps capping peasants only, so after promotion growth comes from governors.
- **Governors arrive through the desk.** A `candidate` desk kind offers a named governor with traits, a village size and a coin price. Taking one is the hire; declining or letting it expire passes. Candidates appear only after promotion and only while below the cap. This reuses the desk's slots, expiry and offer flow rather than adding a hiring screen.
- **Traits** (one or two per governor, drawn from a new `governors` RNG stream at hire):
  - *Diligent*: output times 1.15.
  - *Skimmer*: output times 0.8, reports full output.
  - *Braggart*: honest output, reports times 1.4.
  - *Hoarder*: output times 0.9, keeps the difference and hands it over as a lump when they leave.
  - *Empire-builder*: village grows by one peasant a season up to a limit, and reports times 1.2.
- **Unreliable reports.** A governor's reported output is real output times a report factor. The view adds the gap to each resource's displayed rate and shows reported output on the governor's row. Stock is never inflated, so a skimmer's rate visibly outruns what lands in the stores. That mismatch is the tell before precision.
- **Turnover.** Each governor has a term drawn at hire (several game years). At the end of the term they retire. Each season carries a small chance of death. A failed audit dismisses the governor with the largest gap between report and output, or the newest governor if no one exaggerates. That is the design doc's "punished for the steward's own fudged numbers". Departed governors move to `formerStaff` with the reason and tick. The cap on active governors starts at 4.
- **Crown favor** is a number from -100 to 100 on `CrownState`, starting at 0. A demand met adds 10, plus 5 if it was met early. A missed demand subtracts 15, a failed audit 20, a deepened audit 5, and a backed audit adds 5. Favor never decays. There are three bands: *cold* below -30, *neutral*, and *warm* above 30.
  - *Cold* lowers the audit debt share from 0.5 to 0.35, shortens the warning, and raises each demand's growth step.
  - *Warm* raises the illusion ceiling per peasant by a third and the early-delivery reward. It also makes candidates arrive more often.
  - The Crown panel shows the band word only, never the number.
- **Precision** adds three Archive entries:
  - `precision.ledger` shows debt per resource, rounded to the nearest 10, on the Ledger, and gates the `debt` decree quantity.
  - `precision.exact` requires `precision.ledger`. It shows exact debt and the ticks until an announced audit arrives.
  - `precision.reports` strips exaggeration. Governor rows and rates show real output, and the gap is shown beside each governor.

## Approach

### State

- `Delegate` becomes a union: `Peasant {id, name, kind: "peasant", job, grudgeUntil}` and `Governor {..., kind: "governor", village, traits, hiredAt, termEndsAt, hoard}`. Ids stay numbers from `posting.nextDelegateId`, and `GovernorView.id` becomes a number.
- `posting.formerStaff: FormerGovernor[]`, which records the name, traits, hire tick, departure tick and reason.
- `CrownState.favor: number`.
- `RNG_STREAMS` gains `governors`.
- Schema 13 or 14, depending on merge order. The upgrade step adds `favor: 0`, empty `formerStaff`, seeds `governors`, and sets every delegate's `kind` to `peasant`.

### Economy

`DelegateManager.workingCountsAt` today counts heads per job. It becomes worker-weighted: a peasant is one worker, and a governor is `village` times their trait output factor. Upkeep (grain eaten) uses population. Everything downstream, including flows, projection, decrees and the eaten line, reads the same counts, so no second economy path appears.

### View

- `GameView.governors` lists each governor's name, job, village, traits, reported output and, with `precision.reports`, the real output and the gap.
- Ledger rates add the report gap unless `precision.reports` is owned.
- `CrownView.favor` is the band.
- `IllusionView` adds `debt` per resource, rounded or exact by precision, and `auditInTicks`.

### TUI

- The Peasants panel lists governors above peasants with their village size and trait words, and `assign` works on them unchanged.
- The Crown panel shows favor.
- Candidates render as a desk entry like an offer.
- Help gains a Governors topic, and the Illusion topic gains precision.
- All wording goes in `src/core/copy.ts`.

### Runner and balance

- **Strategies must settle audits.** Commands that answer a desk entry also accept the open audit by kind, so a strategy can back or deepen without an id. This is the gap the phase 7 handoff called out.
- **The gate.** Over 10 game years on seeds 1, 7 and 42, the borrower (forges, then backs before the deadline) ends with higher crown favor and more demands met than crown-aware (never conjures), and the conjurer (never repays) ends cold with the most audits failed. This is the uncertainty to retire first: if no tuning makes the borrower win, the favor numbers or the audit trigger change, not the gate.
- **The first forged quota no longer brings an audit by itself.** The phase 7 gotcha is that a 300 grain demand is worth exactly half the ceiling at 20 peasants. The audit debt share rises, or the ceiling rises with favor, so one forged quota repaid within a season stays below it.

## PRs

```
main ── PR 0 archive-hidden-and-food-eaten   (#20, in review)
main ── PR 1 crown-favor ───────────┐
main ── PR 2 governors-core ────────┴── PR 3 governors-tui-and-precision
```

PR 1 and PR 2 run in parallel. Each bumps the schema, so whichever merges second rebases onto the other and takes the next version; the conflict is confined to `SCHEMA_VERSION` and `UPGRADES`. PR 3 needs both.

### PR 1: `crown-favor` (from `main`)

The highest-uncertainty piece, because it carries the exit gate.

- `CrownState.favor`. `CrownManager` gains `favor` adjustments in `meet`, `recordMiss` and `credit` (early), plus a `band` getter. Audit outcomes in `IllusionManager.settleAudit`, `failAudit` and deepen call the crown.
- Band effects, read where the numbers are used today: the audit trigger in `IllusionManager.run`, the demand growth in `CrownManager.issue`, `ceiling`, and the early reward in `credit`. Band numbers go in `data/crown.json` under `favor`.
- `CrownView.favor` band word. The TUI shows it in the Crown panel and in the summary's copy.
- Commands accept the open audit by kind, and `strategies/borrower.json` uses that to back audits.
- Retune `data/illusion.json` so one repaid forged quota does not trigger an audit.
- Runner summary gains `crown.favor`. In `src/runner/strategies.test.ts`, the gate described above replaces the current repayment check.
- Schema upgrade adds `favor: 0`.
- Tests: favor moves on each outcome (met, early, missed, audit backed, deepened, failed), pairing a positive and a negative case. Each band changes its numbers (pair cold and warm against neutral). The upgrade test.

### PR 2: `governors-core` (from `main`)

- The `Delegate` union, `DelegateManager.population`, worker-weighted counts, and population readers moved over.
- `src/core/governors.ts`: `GovernorManager` handles hiring from a candidate, traits and output and report factors, empire-builder growth, term and death, dismissal on a failed audit (a hook `IllusionManager.failAudit` calls), the hoard lump on departure, and `formerStaff`.
- The `candidate` desk kind in `data/desk.json` with templates. Arrivals are gated on promotion and the cap; the price and village size are drawn from `data/governors.json`.
- `data/governors.json` holds traits, factors, village size range, term range, death chance, cap and price. It needs a schema in `src/core/tuning.ts` and a line in `src/save/content.ts`.
- The view's `governors` list and the report gap on ledger rates (without precision yet).
- The `governors` RNG stream and the schema upgrade.
- Runner: a strategy that hires every candidate after promotion (`strategies/governor.json`) reaches a higher population than crown-aware over 10 years, without starving.
- Tests:
  - Population sums villages.
  - Each trait's output and report factor.
  - A skimmer's displayed rate exceeds the real flow.
  - A term ends in retirement and lands in `formerStaff`.
  - A failed audit dismisses the worst exaggerator, and the newest governor when no one exaggerates.
  - Candidates do not arrive before promotion or at the cap.
  - The upgrade test.
  - The golden changes only because state gained fields and a stream.

### PR 3: `governors-tui-and-precision` (from `main` after PR 1 and PR 2)

- Peasants panel governor rows, candidate desk rendering, departure notices (retired, died, dismissed), the Governors help topic.
- Three `precision.*` Archive entries in `data/archive.json` and constants in `src/core/unlocks.ts`, plus the `debt` quantity gated through `DECREE_GATES`.
- View reads precision for debt display, audit timing and stripping exaggeration. The Ledger shows debt lines, and governor rows show the gap.
- Manual run on a scratch save: promote, hire two candidates, see a skimmer's rate outrun the stores, buy `precision.reports`, see it corrected.

## Review patterns

Carried from phases 6 and 7:

- Logic lives in classes, and saved state uses sentinels rather than `null`.
- A golden change is a bug to explain, not a fixture to refresh.
- Every manual TUI run uses `STEWARD_SAVE_DIR=$(mktemp -d)`.
- PRs merge on GitHub with merge commits. For a stack, retarget the next PR to `main` before merging it.
- Plan excerpts are specs. Their bullet and shorthand style must not leak into code comments.
- All player-facing wording lives in `src/core/copy.ts`.

## Risks

- **The gate may not be reachable by tuning alone.** If the borrower cannot beat crown-aware, the fix is a design change (for example, favor rewarding early delivery more), which goes back to Garret rather than being forced through by numbers.
- **Worker-weighted counts touch every economy reader.** The golden hash will move only for state shape, not for pre-promotion play. If pre-promotion numbers move, something changed that should not have.
- **Governors may swamp peasants.** A village of 8 or more on one job makes individual peasants irrelevant after promotion, which is intended, but the Peasants panel's density needs a look in PR 3.
- **Parallel schema bumps.** Expect a one-line rebase on whichever of PR 1 or PR 2 merges second.

## Progress

- PR 0 `archive-hidden-and-food-eaten`: #20 open at 4e68a1c, `bun run check` 999 pass.
- PR 1 `crown-favor`: f77e4c1, `bun run check` 1013 pass, strict gate holds on seeds 1, 7, 42 (crown-aware favor 27 with one miss, borrower 49, conjurer cold). #21 at 30cdc8f with the grain reserve, 1016 pass.
- PR 2 `governors-core`: c3a55d8 stacked on `crown-favor`, 1057 pass; governor strategy reaches population 63, 63, 71 against crown-aware 40. #22 open against `crown-favor` at 305b154 (rebased onto the grain reserve), 1059 pass, governor strategy population 57, 68, 60 against 40 with no starvation; dead `career.formerStaff` removed (golden changed only for that field).

## Notes and decisions

- 2026-11-11: Garret chose governors as big delegates, crown favor only, and precision for debt and governor truth. Garret's two additions (hide the locked Archive, show grain eaten per second) ship as their own PR ahead of phase 8.
- 2026-11-11: Labor decrees and famine act on peasants only (Garret, option A on both).
- 2026-11-11: The first crown-favor run showed crown-aware meeting all 8 demands early and capping favor at 100, so illusion had nothing to pay off and the conjurer stayed warm. Garret chose harder demands: demand growth rises until honest play misses some, favor amounts shrink to about met +5 and early +2, and the strict gate stays. `ceilingPerPeasant` went from 15 to 20 instead of raising the audit debt share. A new `auditors` decree quantity lets strategies react to an open audit. The generic desk command is `settle {kind, option}`.
- Risk to watch: demands do not scale with population, so governors may make them easy again after promotion. Check this once both PRs are in.
- 2026-11-11: Final crown-favor tuning: grain base 700 and step 0.3 (other resources unchanged, because forging cannot bridge ore, wood or coin the village does not overproduce); favor met 5, early 2, missed -15, backed 3, deepened -3, failed -25; bands at ±15; `ceilingPerPeasant` 40, so the 700 grain first quota alone does not bring auditors. A `demandTicks` quantity lets the borrower forge near a deadline. The borrower repays before any audit arrives, so the runner never exercises settling an audit; unit tests cover it. A ceiling of 40 doubles the room for the conjured-grain-to-coin loan noted in phase 7, which is worth watching in playtests.
- 2026-11-11: crown-favor's larger grain demands make honest play starve peasants after promotion: crown-aware with the correspondence grant starved 1 and 0 on seeds 1 and 7 on main, and 5 and 9 on `crown-favor` (promotion at tick 8011 in all four). Raised with Garret.
- 2026-11-11: governors-core choices: candidates carry their job and start on it (instead of a `governorsIdle` quantity), a `candidates` quantity counts waiting candidates, famine pacing caps at half the peasants present, report factor is reported over real output and traits multiply, and the hoard is paid on any departure.
- 2026-11-11: Garret found the post-promotion starvation too punishing. Lowering demands alone had no workable window: starvation stayed near 5 from a base of 400 to 700. The cause was `CrownManager.take` emptying the granary at collection and on partial delivery. The crown now never takes the last season of real grain (`grainReserveSeasons` 1 in `data/crown.json`); what the reserve leaves uncovered counts as missed. Grain base lowered from 700 to 625 (step 0.3), the lowest at which the strict gate holds; 600 fails because the conjurer ends at favor 4 on seed 7. Crown-aware and borrower now starve 0 on every seed; the conjurer still starves 4 on seed 1. #21 at 30cdc8f, 1016 pass.
- 2026-11-11: #20 merged to main. #22 merged into `crown-favor`, so #21 now carries governors too. Merged main into `crown-favor` at 90ceb01 (conflict in `src/core/view.ts` only, both sides kept); 1062 pass, golden unchanged.
- 2026-11-11: Playtest feedback from Garret: the player cannot tell how much debt they owe or must repay, and wants more control over labor decrees. Decisions: the Ledger always shows rough debt per resource (rounded up to the nearest 10), and repaying states the amount. Precision now sells only `precision.exact` (exact debt, audit timing, gates the `debt` quantity) and `precision.reports` (strips governor exaggeration); the planned `precision.ledger` tier is dropped. Labor decrees accept custom shares (`labor farm 60 forest 30 mine 10`, normalized), with the presets kept as named splits.
- PR 3 is split: 3a `debt-and-precision` and 3b `labor-shares` run in parallel from `crown-favor`; 3c `governors-tui` (Peasants panel governor rows, candidate rendering polish, departure notices, Governors help topic) follows 3a because both touch the governor view.
- 2026-11-11: 3b `labor-shares` built at 2881c03 (1100 pass, no schema bump: a policy containing a space is a split). `chose` conditions accept presets only. 3a `debt-and-precision` built at a53687c (1081 pass, no schema bump): rough debt line, `back` reports what it repaid through a new ok `message` on `CommandResult`, repay advice on the focused Ledger row, Exact books 350 and True reports 600, and an untimed audit notice without exact books. Buying either entry is unit-tested only. Both in refactor passes.
- 2026-11-11: 3b labor-shares open as #23 against `crown-favor` at 3f6aa3c, 1100 pass, strategies unchanged.
- 2026-11-11: 3a debt-and-precision open as #24 against `crown-favor` at 0d2db8e, 1080 pass; a follow-up restores thousands separators on exact debt. 3c governors-tui dispatched from `debt-and-precision`.
