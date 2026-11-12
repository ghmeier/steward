---
title: "Governors playtest merged: tech tree, illusion relief, pacing and balance"
status: open
tags: [playtest]
created: 2026-11-12
updated: 2026-11-12
---
# Governors playtest merged: tech tree, illusion relief, pacing and balance

## Context

This continues [[plan/playtest/2026-11-12-governors-playtest]], now completed. The research is in [[research/playtest/2026-11-12-governors-playtest]], and the work follows [[handoff/promotion/phase-8-done]].

Garret playtested the governors build and sent 18 items. All of them are on `main` at 9d62129. The save schema is version 17.

## What we built

### The Archive is a tech tree

- **A new village starts with only the Ledger and Peasants.** Everything else is an Archive purchase: the Court, Decrees, the Crown charter, conjuring, forging, governors and the control upgrades.
- **Prices.** An entry can cost any mix of grain, wood, ore and coin: `cost: Partial<Record<Resource, number>>`.
- **Reveals.**
  - An entry is revealed by its `shown` condition. That is either a simple condition, the literal `"promotion"`, or `"governor"`, which means a governor has been hired.
  - A reveal latches into `career.seen`.
  - The Archive lists only entries that are seen, not owned, and whose `requires` are met, so owned entries are hidden.
- **The Archive opens** when grain passes 66. Decrees is offered at once, for 50 grain.
- **Crown demands start when you buy the Crown charter**, not at promotion.
- **Panel and command gates.**
  - `PANEL_UNLOCKS` and `COMMAND_UNLOCKS` in `src/core/unlocks.ts` are the single sources.
  - The TUI keys, command-line verbs and runner all read these tables.
  - Core itself does not refuse decree or Court commands without their panels, so old command logs still replay.
- **Effects.**
  - An entry can carry `effects: {modifierId: number}`. `MODIFIERS` says whether each id multiplies (a factor) or adds (a gap).
  - Each manager applies its own modifiers inside its tuning getters. Economy owns caps, yields and sell price; illusion owns interest and the audit gap; governors own the death chance and the cap.
  - `GameView.live` exposes the adjusted figures to the Ledger and to help.
- **Stockpile caps.**
  - Grain 500, wood 200, ore 100. Coin has no cap.
  - Caps are enforced in `add()` through `AddContext.capOf`. Production past a cap is lost, and stock already above a cap is kept.
  - The Ledger shows "amount / cap".
- **Upgrades.** There are 22 in three tiers:
  - Tier 1 is revealed by population, from 5 to 15.
  - Tier 2 is after the charter.
  - Tier 3 is after a governor is hired.
  - They cover storehouses, tools, market rights, the moneylender's favor, friends at court, a physician, petitions and omens, and more governor slots. Most are priced in wood and ore.
- **"Is full".** A decree condition such as "wood is full" lets a decree sell or feed what a full store would otherwise lose. The capped resources are listed once, in `CAPPED_RESOURCES` in `src/core/realm.ts`.

### Illusion relief

- **Interest** is simple interest of 5% of principal per season. It is charged at season ends and never compounds.
- **Audits** are at least `minGapTicks` (1200) apart, plus a warm-favor bonus and the *Friends at court* upgrade.
- **Deepening an audit** adds a flat fee instead of multiplying the debt.
- **A failed audit** leaves a season of grain. `CrownManager.reservedOf` is the one reserve rule.
- **`forgeMissing`** (`F` on the Crown panel) delivers what you hold, then forges the rest.
- **Conjuring** prints a message. The Ledger shows "(+N conjured, fading)".

### Pacing and the Court

- **Crown demands.** The first demand, the deadline and the gap are each drawn from a range: `firstDemand` 600 to 1800, `deadline` 1200 to 2400, `gap` 2400 to 4200 ticks.
- **Demand amounts** are coin 180, grain 400, wood 160 and ore 80. Each demand met raises the next by 15% of the base.
- **Governors.**
  - A governor dies at 1% a season, or 0.5% with the physician.
  - The death notice names a cause.
  - Each governor's row shows the seasons left in their term.
- **Idle peasants** eat 40% of a working peasant's grain.
- **Court missives.**
  - Missive amounts scale with population when drawn. The factor is stored on the entry.
  - Travellers bring more newcomers in a larger village.
  - Grudges don't scale.
  - There are more templates, and two new kinds: `petition` and `omen`.

### Village screen

- **The village has a name.** A prompt asks for it when you found the village. Old saves get a name picked from their seed.
- **Title ladder.** The Ledger shows "Title  <Reeve|Steward|High steward> of <name>".
- **Panel widths.** The top row's weights are Ledger 1, Peasants 2, Archive 1.
- **The eaten rate** sits on the grain row.
- **Governor rows** read "reports N grain/s". After *True reports* they read "brings in N grain/s, claims N more".

### Tests

- **Strategy tests.** The comparison tests are gone (#36). The strategies that remain are `reference` and `seasonal`. The tests that remain check that:
  - a recorded game replays to the same hash
  - honest play never starves and gets promoted
  - every first-tier upgrade is seen before promotion
- **Progress checks:**
  - A new village that only farms can afford its first purchase (`src/core/unlocks.test.ts`).
  - Every Archive cost fits within the stores you can build without that entry (`src/core/upgrades.test.ts`).
- **Speed.** `bun test` runs in about 2.6 seconds.

## Key files

| File | What it does |
| --- | --- |
| `src/core/unlocks.ts` | Unlocks, reveals, multi-resource buying, `PANEL_UNLOCKS`, `COMMAND_UNLOCKS`, `MODIFIERS`, `modifier(id)` |
| `data/archive.json` | Every Archive entry, with its cost, reveal, requires and effects |
| `src/core/economy.ts` | Caps (`capOf`), yields, sell price, idle upkeep (`grainUpkeepPerTick`), `seasonEnds` |
| `src/core/math.ts` | `add()` with the cap through `AddContext.capOf` |
| `src/core/illusion.ts` | Principal and simple interest, the audit gap, deepen fee, `forgeMissing` |
| `src/core/crown.ts` | Demand ranges, `grainReserve` and `reservedOf`, scheduling the first demand when the charter is bought |
| `src/core/desk.ts`, `data/desk.json` | Missive scaling, the petition and omen kinds and their unlock gating |
| `src/core/governors.ts`, `data/governors.json` | Death causes, seasons left, modifiers |
| `src/core/conditions.ts`, `src/tui/decree-grammar.ts` | The "is full" condition |
| `src/tui/text-edit.ts`, `src/tui/name-prompt.ts` | Shared text editing, and the village name prompt |
| `src/runner/strategy.ts` | `StrategyPlayer`, with a `purchases` list and setup steps that wait for their unlock |
| `src/runner/strategies.test.ts` | Replay, honest-play and tier-1 reachability invariants |
| `src/core/upgrades.test.ts` | Modifiers, caps, reveals, and costs fitting within the stores |

## PRs

| PR | Branch | What it did |
| --- | --- | --- |
| #31 | `village-polish` | Village name, title ladder, panel widths, eaten on the grain row, governor report text |
| #32 | `pacing` | Crown timing drawn from ranges, gentler governor deaths with causes, idle upkeep |
| #33 | `court-missives` | Missives scale with population, more templates, petitions and omens |
| #34 | `illusion-relief` | Simple interest, audit spacing, reserve on seizure, `forgeMissing`, conjure feedback |
| #35 | `tech-tree-foundation` | The Archive as a multi-resource, threshold-revealed shop gating every panel and control |
| #36 | `trim-strategy-tests` | Removed the comparison tests between strategies |
| #37 | `tech-tree-upgrades` | Effects mechanism, stockpile caps, 22 upgrades |
| #38 | `decree-full-condition` | The "is full" decree condition |
| #39 | `tech-tree-balance` | Opening, reveal, cap and crown tuning |

## In progress

Nothing. Garret is playing the merged build.

## Next steps

1. **Fold in what Garret finds in play.** The "what to try" list in #39 is the starting point:
   - typing the first decree
   - shifting labor off farming around population 10
   - whether the first grain demand needing the Granary feels fair
   - a coin demand just after the charter is bought
   - `forge missing`
   - ore as the tightest resource
2. **Command-line usability.** In the balance pass, typing the first decree took about 3 minutes. The command line keeps its text after Escape, and the first Enter accepts a completion instead of issuing the command.
3. **Tune tier-2 and tier-3 prices.** They have not been tuned, and no one has played a governed village by hand.
4. **Phase 9: ending a posting.** This was the next item before the playtest.

## Gotchas

- **The golden file.** `bun run golden:update` grants every Archive entry, and it writes tabs, so run `bunx biome check --write test/golden.json` afterwards. Almost any data change moves its hash.
- **Strategy tests.** Don't reintroduce comparative or timing tests between strategies. They were re-tuned with every design change and once forced a game constant (`favor.failed`) just to keep a test passing. For balance, read the sim's summaries with `bun src/runner/sim.ts --seed N --steps N --strategy file.json`, and assert only progress invariants.
- **The first full tick.** Production is stored before decrees act, so the first tick at a full store loses its production even with an "is full" decree.
- **The first grain demand (400)** needs the first Granary. The base cap is 500 and the crown keeps a one-season reserve. This is deliberate, but untested by hand.
- **Crown demands scaling with population** was prototyped and rejected, because it made governed demands unwinnable.
- **Command gates.** Core accepts decree and Court commands without their panels. Only the TUI and runner gate them, so that old command logs replay.
- **The Ledger's focus** needs the charter, not conjuring, so a player can focus it to repay debt once forging and conjuring are split.
- **Missive scale factor.** It is stored on the desk entry when the entry arrives, and old entries read as 1. No schema bump was needed.
- **Stacked branches.** When a branch was stacked on a parent that was squash-merged, it needed `git rebase --onto origin/main <parent> <branch>`.
