---
title: "Governors playtest: tech tree, illusion relief, pacing and polish"
status: active
last_pr: 33
tags: [playtest]
created: 2026-11-12
updated: 2026-11-12
next_step: PR #31 (village-polish) open; others in refactor or implementation
---
# Governors playtest: tech tree, illusion relief, pacing and polish

Research: [[research/playtest/2026-11-12-governors-playtest]]. Continues [[handoff/promotion/phase-8-done]].

## Decisions from Garret (2026-11-12)

- **Item 7** means Court missives, not decree grammar.
- **A new village starts with Ledger and Peasants only.** The Court, Decrees, Archive and Crown panels, governors, forging and conjuring are all bought. The Archive becomes the shop and opens on a small threshold.
- **Conjuring stays outsider-only.** It gets a success message and a clearer display, and becomes a purchase.
- **Buying the Crown charter starts demands.** Promotion reveals the charter, and buying it is required to keep advancing: governors and the later tiers sit behind it.

## Defaults I chose (flag if wrong)

- **Interest** becomes simple interest per season:
  - At each season end, debt grows by `interestPerSeason` (5%) of its principal, meaning what was forged or spent. Interest never compounds.
  - Deepening an audit adds a flat fee on top of the principal instead of multiplying the debt by 1.5.
- **Audits** come at most once every `minGapTicks` (2 seasons) after the last one closes.
  - Warm favor adds a season. An upgrade, *Friends at court*, adds another.
  - The thresholds for debt value and debt age stay, but neither can fire inside the gap.
- **When an audit fails**, the auditors leave one season of real grain, the same reserve the crown already keeps.
- **Forge missing** is a single command, `forge missing`, on the `F` key in the Crown panel. It delivers what you hold above the reserve, then forges the rest.
- **Crown pacing:**
  - The gap between demands goes from 2–4 seasons to 4–7.
  - The deadline is drawn from 2–4 seasons instead of a fixed 3.
  - The first demand comes 1–3 seasons after the charter is bought.
- **Governor deaths:**
  - The chance drops from 2% to 1% a season.
  - The notice names a cause, drawn from a short list (fever, a fall, a winter cough).
  - Each governor's row shows "N seasons left".
  - An upgrade, *Village physician*, halves the chance again.
- **Missive scaling:**
  - Resource amounts on missive options multiply by `max(1, population / 10)`, rounded.
  - A grudge stays one peasant for one season, so it shrinks relative to the realm.
  - Travellers who join the village bring `ceil(population / 15)` newcomers.
- **Idle peasants** eat 40% of a working peasant's grain (`idleGrainFactor` 0.4). That includes peasants idled by a grudge.
- **Titles** come from a ladder in data:
  - Reeve at the start.
  - Steward at promotion.
  - High steward once the charter is bought and a governor serves.
  - The Ledger shows "Title  Steward of <village>" in place of the promotion-time line. The progress line before promotion stays.
- **Village name:**
  - When founding a village you type a name, with a random default from a list.
  - Old saves get a random name from that list.
- **Panel widths:** the top row's weights become Ledger 1, Peasants 2 and Archive 1, instead of 1, 1 and 2.

## PR breakdown

Wave 1 has five independent PRs. Wave 2 builds the upgrades that change numbers and needs all of wave 1. Wave 3 is a balance pass.

```
wave 1:  [1 tech-tree-foundation]  [2 illusion-relief]  [3 pacing]  [4 court-missives]  [5 village-polish]
              \__________________________|____________________|_____________|_______________/
wave 2:                         [6 tech-tree-upgrades]
wave 3:                         [7 tech-tree-balance]
```

**Save schema bumps.** PRs 1, 2 and 5 each add state, so each needs a schema bump. They are written as `UPGRADES[14]` in parallel. Whichever merges second or third rebases and renumbers to 15 and 16. The implementers are told this up front.

### 1. `tech-tree-foundation` (highest uncertainty, starts first)

Objective: turn the Archive into a shop that charges any resource and reveals entries by threshold, and put every panel and control behind it.

- **Multi-resource costs.**
  - `ArchiveEntry.cost` becomes `Partial<Record<Resource, number>>` (`src/core/unlocks.ts`, the archive zod schema).
  - `buy` checks and spends each resource. Coin and grain spend through `illusion.spend`; wood and ore spend real stock.
  - `view.ts` reports cost per resource and whether each part is affordable.
  - `archiveLabel` renders, for example, "40 wood · 10 ore".
- **Visibility that latches.**
  - Entries take an optional `shown: Condition`, restricted like `play` by `simpleCondition`.
  - `UnlockManager.run` latches seen ids into `career.seen`; an entry with no `shown` is seen at once.
  - The view lists only entries that are seen, not owned, and whose `requires` are met.
  - Owned entries are hidden (item 14). An empty Archive shows "Nothing more to learn, for now."
- **Generic panel locks.**
  - `lockedPanels()` derives from every panel's static `keys.needs`, instead of hard-coding the Archive and Crown panels. `PanelId` widens to match.
  - Court and Decrees get `needs`.
  - `career.needed` and the `needs` block in `archive.json` are folded in or removed if nothing reads them; the research found no reader.
- **New gates.** Each line gives the id, its cost, and what reveals it. The amounts are first guesses that PR 7 tunes.
  - `panel.archive` stays a `play` rule. The trigger changes from coin above 0 to grain above 40, so the shop opens on the first harvest.
  - `panel.court`: 30 grain; shown at population above 1.
  - `panel.decrees`: 40 wood; shown at wood above 10.
  - `panel.crown` (the "Crown charter"): 200 coin and 100 wood; shown at promotion.
    - Buying it schedules the first demand.
    - Remove the grant at promotion (`step.ts:30-40`).
  - `control.conjuring`: 100 coin; requires the charter.
    - Remove the grant on the first demand (`crown.ts:308-309`).
  - `control.forging`: 150 coin and 50 ore; requires the charter.
    - This is a new id, split from conjuring, that gates `forge` and `back`. `back` stays available while any debt exists.
  - `control.governors`: 300 coin and 150 wood; requires the charter.
    - `GovernorManager.canOffer` checks it instead of `promotedAt`.
  - The existing coin-only entries get `shown` thresholds and keep their prices.
- **Migration.** Saves that already have the Court, Decrees, Crown panel, conjuring, or a promotion keep what they had. The promotion grants forging and governors, following the patterns in steps 9 and 11.
- **Runner.**
  - Strategies gain a `purchases` list: unlock ids, bought in order as each becomes affordable.
  - Setup commands that need a panel, such as `enactDecree`, wait until it is owned.
  - Update the existing strategies. The phase 8 exit gate in `src/runner/strategies.test.ts` must still hold, with thresholds re-tuned if needed, noted in the PR.
- **Tests.**
  - Unit tests: buying with a mixed cost, and refusal when one resource is short.
  - `shown` latches after the stock falls back.
  - Owned and unseen entries are hidden.
  - A locked Court panel cannot be focused.
  - The charter starts demands.
  - Migration grandfathers an old save.

### 2. `illusion-relief` (items 10, 12a, 13, 15, 16)

Objective: make forging a survivable gamble and make conjuring visibly do something.

- **Simple interest.**
  - `IllusionState` tracks `principal` per resource. `run()` adds `principal * interestPerSeason` at season ends instead of compounding every tick.
  - Repaying, through `back` or seizure, reduces the principal first.
  - Replace `interestPerTick` with `interestPerSeason` (0.05) in `data/illusion.json`.
- **Audit spacing.**
  - `lastAuditClosedAt` in state.
  - `runAudit` cannot announce an audit inside `audit.minGapTicks` (1200), plus a band bonus in `crown.json` (`warm.auditGapTicks` 600).
  - Expose a hook so PR 6 can add the gap from the *Friends at court* upgrade. A getter is enough.
- **Deepening.** Deepening charges its coin fee and adds `deepenFee` (10% of principal) to the debt. The 1.5× multiplier goes.
- **Seizure keeps the reserve.** `failAudit` leaves `grainReserveSeasons` of real grain. Reuse the crown's reserve calculation and move it somewhere both can call.
- **Forge missing.**
  - A `forgeMissing` command, or a `missing` flag on `forge`, runs `crown.deliver` and then `forge` on the remainder.
  - It gets a command-line verb and the `F` key on the Crown panel, with a hint.
- **Conjure feedback.**
  - Conjure returns a message: "You conjure 25 grain. It will fool the crown, the Archive and the Court, not the peasants."
  - The Ledger's conjured line reads "(+N conjured, fading)".
  - Update the help topic.
- **Gate.** The borrower and conjurer strategies still pass the favor gate. Add a test that forging one demand at population 20 brings no more than one audit in 4 seasons.

### 3. `pacing` (items 5, 11, 12b)

Objective: give the crown and governors more breathing room, and let a village hunker down.

- **Crown cadence.**
  - `crown.json`: `gap` becomes 2400–4200. `deadline` becomes `{minTicks 1200, maxTicks 2400}`, drawn with `drawDelay`. `firstDemand` becomes `{600, 1800}`.
  - The schema changes in `crownTuningSchema`.
- **Governor deaths.**
  - `deathPerMille` becomes 10.
  - `causes` in `data/governors.json`; the notice uses one.
  - `GovernorView.seasonsLeft`, shown on the roster row.
  - Expose a death-chance getter for PR 6's *Village physician*.
- **Idle upkeep.**
  - `idleGrainFactor` in economy tuning.
  - `upkeepOf`, `grainUpkeepPerSeason` and the view's eaten rate all use one method on `EconomyManager`.
  - Update the help text for grain.
- **Tests.**
  - Upkeep with idle peasants.
  - The deadline falls within its range.
  - The death notice carries a cause.
  - `seasonsLeft` counts down.
  - The strategies gate still holds.

### 4. `court-missives` (items 7, 8)

Objective: more Court variety, scaled to the size of the realm.

- **Scaling.**
  - `DeskManager` scales option resource amounts by `scaleFor(population)` when it draws an entry, so the stored entry keeps its scaled numbers.
  - Travellers' newcomer count scales the same way.
  - The tuning lives in `desk.json` (`scale.perPopulation`, `scale.newcomersPer`).
- **Content.**
  - At least 4 more disputes, 3 more merchants and 2 more travellers.
  - Two new kinds:
    - **petition**: a peasant asks for something. Paying earns a short output boost or a newcomer; refusing gives a grudge.
    - **omen**: a traveller predicts a lean season, and you can pay to prepare.
  - The new kinds are drawn by weight, and their weight is gated by an unlock id so PR 6 can sell them.
  - Use `{first}`/`{second}` names the same way existing templates do.
- **Tests.**
  - Amounts scale at population 40 compared with 5.
  - Grudges don't scale.
  - A gated kind is never drawn without its unlock.
  - The content schema validates.

### 5. `village-polish` (items 3, 4, 6, 9, 17)

Objective: small screen and copy fixes from the playtest.

- **Panel widths:** top row weights Ledger 1, Peasants 2, Archive 1 (`panels.ts:231-236`).
- **Eaten line:** "(N/s eaten)" moves onto the grain row.
- **Title.**
  - A `titles` ladder in data.
  - `view.title`.
  - The Ledger shows the title and village name.
  - Remove `copy.ledger.promotedOn`.
- **Village name.**
  - `posting.name` in state, with a schema bump and migration.
  - `Game.create` takes a name.
  - The found-village flow opens a text prompt that reuses the command line's editing and cursor, prefilled with a random name from `village.json`.
  - The panel border title or the Ledger header shows the name.
- **Governor copy.**
  - "reports {rate}" becomes "reports {rate} {resource}/s".
  - After True reports: "brings in {real} {resource}/s, claims {gap} more" or "claims only what they bring in".
- **Tests.**
  - Update the ledger, roster and panels tests.
  - Add a test that founding a village with a typed name saves it.

### 6. `tech-tree-upgrades` (wave 2: after 1 to 5)

Objective: give wood and ore something to buy, and fill the tree. Every upgrade changes a number through its owning system's tuning getter, keyed by a factor declared in the entry's data.

- **The effects mechanism.**
  - Entries take `effects: { <modifierId>: number }`.
  - `UnlockManager.modifier(id)` combines the owned entries' values. Factors multiply and gaps add; the kind is stated per modifier id in one table.
  - Each manager's getter applies its own modifiers. Wood and ore yields go through one getter used by both `yieldPerWorker` and `run`.
- **Stockpile caps.**
  - Real per-resource caps go through `add()`. The Ledger shows "120 / 200".
  - Overflow is lost.
  - Granary, woodshed and ore-store upgrades come in three tiers each.
  - This is new state behavior, so the starting caps need tuning in PR 7.
- **Other upgrades:**
  - Better tools: yield per job, in 2 tiers each.
  - Market rights: sell price.
  - Moneylender's favor: interest per season.
  - Friends at court: audit gap.
  - Village physician: governor deaths.
  - Petitions and omens: the Court kinds from PR 4.
  - More governor slots.
- About 20 entries in all, spread over three tiers: before promotion, after the charter, and after a governor serves.

### 7. `tech-tree-balance` (wave 3)

Objective: tune costs and thresholds so wood and ore are worth producing, and the first hour paces well.

- Strategies buy the tree.
- Add a `builder` strategy that buys yield and cap upgrades greedily.
- Gate: on seeds 1, 7 and 42, the builder reaches promotion and buys the charter within N years, and the existing exit gate still holds.
- Garret plays it by hand before merge.

## Acceptance

- `bun run check` passes on every PR.
- The strategies gate in `src/runner/strategies.test.ts` holds after each PR, with any re-tuned thresholds stated in the PR description.
- For each TUI change, an implementer launches the game with `STEWARD_SAVE_DIR` set to a scratch directory and confirms the change on screen, not only in test frames.

## Review patterns

- Comments explain why, never what. Plan wording, arrows and item numbers must not leak into code.
- New numbers go in `data/*.json` with a schema in the owning system (commit 1dfc2c9). No literals in managers.
- Player-facing strings go in `src/core/copy.ts`.

## Notes and decisions

- 2026-11-12: Plan drafted from four research passes. Garret answered the four questions above.
- 2026-11-12: `village-polish` built: save schema now 15 (`UPGRADES[14]`). The title line shows from the start ("Reeve of X"). Old saves get a name picked from their seed. In refactor.
- 2026-11-12: `court-missives` built: scale factor stored on the entry, no schema bump. The golden file picked up `precision.*` unlocks; the refactor pass is checking why. In refactor.
- 2026-11-12: `pacing` built: with wider gaps, crown-aware never misses a demand, so the strategies gate was loosened (no missed check, borrower favor `>=`, conjurer test runs 20 years). PR 7 must re-pressure the crown, through amounts or early deadlines. In refactor.
- 2026-11-12: `illusion-relief` built: save schema 15 (`UPGRADES[14]`), which collides with `village-polish`. `favor.failed` went from -25 to -30 so the conjurer still ends cold, because audits are rarer and seizure keeps the reserve. `forgeMissing` is its own command. In refactor.
- 2026-11-12: `village-polish` opened as #31 after the refactor pass (dafb249). 1166 tests pass.
- 2026-11-12: `pacing` opened as #32 (69829ba). The refactor removed the pass-through death-chance getter, so PR 6 adds the modifier where `deathPerMille` is read. Idle eaten now shows 0.04/s.
- 2026-11-12: `court-missives` opened as #33 (97655b9). The golden file was stale on main since a53687c, because the update script grants every Archive entry, so it was regenerated here. Traveller text now reads correctly for one newcomer or several.
