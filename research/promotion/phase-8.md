---
title: "Phase 8 research: what promotion, governors and favor build on"
status: draft
tags: [phase-8]
created: 2026-11-11
updated: 2026-11-11
---
# Phase 8 research: what promotion, governors and favor build on

## Question

Phase 8 of the development plan is "Promotion, governors and favor. Middle management, governor traits, unreliable reports (governor exaggeration joins the computed view), turnover, the active-governor cap, three-way favor thresholds and Archive precision upgrades. Illusion gets its first real balance pass here." Exit: "a posting plays end to end, and in the runner illusion pays off only when the strategy repays it."

What do the design docs actually specify, what does the code already provide, and which decisions are left to us?

## Findings

### What the game design doc specifies

The design doc is thin on this phase. It has no numbers for any of it.

- **Middle management**: after a one-time promotion at a population target, "the same verbs now apply to villages and governors instead of individuals. This is where the main game takes place." Nothing on hiring, assignment, regions or what changes on screen beyond a governors panel.
- **Governors**: named, persistent characters who run villages and towns. Economic traits first (hoarder, skimmer, empire-builder are the examples), personality as flavor. Each keeps a record of how the steward treated them; loyal ones may follow to a new posting (phase 9), wronged ones may become rivals. "Governors report their own numbers, which may be exaggerated depending on their traits." They "age, retire, die, or are punished, sometimes for the steward's own fudged numbers." A small cap on active governors, with departed ones in former-staff rolls. Traits are randomized from a per-posting seed; core production numbers are never random.
- **Favor**: three groups, crown, lords and citizenry. Favor "stays in the background and only matters when it crosses a threshold". Crown favor is driven mostly by quotas; low brings scrutiny and more audits, high brings better postings. Lords are driven by taxes and privileges; a threshold sends lords' demands and schemes to the desk. Citizenry is driven by food, wages and fairness; a threshold causes unrest, which slows production. Favor never decays while idle; it moves only with decrees, shocks and choices. At career end the highest favor picks the ending (phase 9 and later).
- **Archive and precision**: the doc names the Archive as the tech tree and says nothing about precision. Precision comes only from the development plan's architecture notes (the ledger is crude by default and the Archive sells precision).
- **Illusion balance**: "leverage should pay off only with a plan to repay it. Illusion must never be the dominant strategy."

### What the code provides

- **Promotion** is `StepManager.checkPromotion` (`src/core/step.ts:30`): at 20 delegates (`data/village.json` `promotionPopulation`) it stamps `career.promotedAt`, unlocks the Crown panel and schedules the first demand. There is no phase field; `promotedAt !== 0` is the marker. Nothing else changes after promotion: the player keeps assigning individual peasants.
- **Delegates** (`src/core/delegates.ts`): `{id, name, kind: "peasant", job, grudgeUntil}`. `kind` was left as the discriminant for governors. Population is `posting.delegates.length` everywhere (view, illusion ceiling, promotion), so governors in that array would count as population unless we change that.
- **Governor placeholders**: `GovernorView {id: string, name}` and `GameView.governors: []` in `src/core/view.ts`. The id type disagrees with delegate ids (numbers).
- **Computed view** (`src/core/view.ts`): the UI reads only `GameView`. Ledger lines already show apparent amounts (real plus conjured). Governor exaggeration would apply in the same place, on `amount` and `ratePerSecond`.
- **Crown** (`src/core/crown.ts`): `met`, `missed`, `surcharge`. `recordMiss` is shared by missed collections and failed audits. No favor yet.
- **Books** (`src/core/illusion.ts` `books`): exposure over ceiling, cut at 0.33 and 0.66 into clean, thin, strained and rotten. The `debt` decree quantity reveals the exact figure and is ungated.
- **Archive** (`data/archive.json`, `src/core/unlocks.ts`): five entries, no `precision.*` ids yet. Adding an entry is data plus a constant plus view logic reading `unlocks.enabled`.
- **Save**: schema 12; the next upgrade step is `UPGRADES[12]`. New RNG streams (a `governors` stream) need seeding in the upgrade step, as `crown` did at 9.
- **Tuning**: `src/save/content.ts` merges `data/*.json` into one Zod-validated `Tuning`. A `data/governors.json` and `data/favor.json` follow that pattern.
- **Runner**: strategies in `strategies/*.json`, gates in `src/runner/strategies.test.ts`. The phase 7 handoff notes that the borrower (forges and repays) does no better than crown-aware (never conjures), so the exit's "illusion pays off only when repaid" is not met today, and no strategy can settle an audit because it cannot name a desk entry's id.
- Tests are colocated (`*.test.ts`); `test/` holds only shared helpers, fixtures and the golden hash. The tech-debt item in the untracked `REFINEMENTS.md` is already done, and its layout proposal was built by `plan/tui/village-layout`.

## Sources

- Development plan: https://claude.ai/artifact/W1LESSbnonaotUx1qEu93J (build order item 8)
- Game design doc: https://claude.ai/artifact/NgCC6Q1LNo423bMujycHiV (Progression, Governors, Favor and politics, Resources and illusion)
- [[handoff/illusion/phase-7-done]], [[plan/illusion/phase-7]]

## Open questions

1. What middle management is mechanically: what a governor runs and how that feeds the posting's single stock.
2. Whether favor is three groups with real drivers this phase, or crown favor first.
3. What precision the Archive sells.
4. Whether phase 8 is one plan or split (governors, favor, precision and balance are separable).
