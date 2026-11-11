---
title: "Phase 7: conjuring, illusion debt and audits"
status: active
tags: [phase-7]
created: 2026-11-11
updated: 2026-11-11
last_pr: 10
next_step: PR 1 (illusion-core) is being implemented; refactor pass and PR follow, then PR 2 and PR 3 in parallel
---
# Phase 7: conjuring, illusion debt and audits

Research: [[research/illusion/phase-7]]. Sources: the development plan (phase 7, "Illusion, debt and audits (crude)") and the game design doc's "Resources and illusion" section. Continues [[plan/crown/phase-6]].

## Goal

The steward can make the books say more than the stores hold. Conjured grain and coin can be handed to outsiders, a forged report can stand in for a crown delivery, and whatever was passed off as real becomes debt. Debt grows, brings an audit to the desk, and the audit has to be backed with real stock.

Exit (from the development plan): in a play session, a player conjures to meet a crown quota early, then faces an audit and has to back it.

This phase is the crude version. Balance, exact debt figures sold by the Archive, favor, and decay while away belong to phases 8 and 10.

## Decisions

Garret, 2026-11-11:

- **Spending.** Conjured stock pays outsiders only: the crown, desk offers and the Archive. Peasants cannot eat it and decrees cannot sell it. The Ledger shows the apparent total.
- **Reports.** A report is a forged delivery. It marks what is still owed on the open crown demand as delivered on paper, in any resource including ore and wood, and the forged amount becomes debt.
- **Failed audit.** The auditors seize real stock toward the debt and the debt is cleared. If stock could not cover it, the failure counts as a missed crown demand, with the usual surcharge on the next demand.
- **Limit.** Conjuring is free. Outstanding illusion plus debt cannot pass a ceiling that scales with population.
- **Crown panel.** Not drawn until it is unlocked. Shipped separately as PR #10 (see "Before phase 7").

Lead defaults, approved by Garret with the plan on 2026-11-11:

- **Unlock.** Conjuring (`control.conjuring`) is granted through play when the crown issues its first demand, with a notice. It is not sold in the Archive.
- **Order of spending.** A payment to an outsider uses conjured stock first, then real stock. Illusions fade, so the player always wants them spent first.
- **One unit for the ceiling.** Illusion and debt in different resources are compared by their market value in coin, using the existing prices (grain 0.5, wood 0.5, ore 1, coin 1). The ceiling is a coin value per peasant.
- **Crude signal.** The Ledger shows conjured stock exactly (the steward knows what they conjured) and shows debt only as a word: "Books: clean", "thin", "strained" or "rotten". An audit's options state the exact cost, so an audit is the one moment the player learns the figure.
- **Backing outside an audit.** A `back` command repays one resource's debt from real stock at any time. This is the "plan to repay".
- **Audit timing.** Debt worth half the ceiling, or any debt four seasons old, sends auditors. They arrive one season after a warning notice and wait a season and a half on the desk. An audit takes a desk slot but is never pushed out by overflow; only its own deadline expires it.
- **Deeper illusion.** Costs real coin worth 20% of the debt's value, multiplies the debt by 1.5, and sends the auditors away. The larger debt soon brings them back.
- **Early-delivery reward.** A forged report that completes a demand before its deadline earns the 10% coin reward like a real delivery. That is the "meet a quota early" payoff the exit asks for.
- **Decrees and strategies.** One new decree quantity, `debt` (the coin value of all debt), ungated. Strategies need it to react; a decree reading it reveals the figure, which is acceptable for the crude phase and is a candidate for an Archive gate in phase 8.

## Before phase 7

- [x] **Hide the Crown panel until it is unlocked.** PR #10, branch `hide-locked-crown` (a74dda6), open against `main`. `VillagePanel.hiddenWhileLocked` (set by `CrownPanel`) makes `draw` in `src/tui/panels.ts` hide the slot, so the bottom row is Court and Decrees until promotion. The Archive still shows "Locked.". 909 tests pass. Known leftover: Help's Keys list names the Crown (and the Archive) before they are owned.
- [ ] **Phase 6 exit playtest.** Still unrecorded in [[plan/crown/phase-6]]. Phase 7 builds on the crown numbers as they are.

## Approach

### The model

`posting.illusion` holds:

- `conjured`: illusory units of grain and coin sitting in the stores. They fade by a fraction every tick.
- `debt`: per resource, the illusory units that were passed off as real (paid to the crown, a merchant or the Archive, or forged in a report). Debt grows by a fraction every tick.
- `debtSince`: the tick the debt last rose from zero, with 0 standing for "no debt", because saved state cannot hold `null`.
- `auditAt`: the tick the announced auditors arrive, with 0 standing for "none on the road".
- `audits`: counts of audits backed, deepened and failed, for the runner and for phase 8's favor.

`posting.resources` stays the truth. Nothing in the per-tick economy, decree flows or rate projection changes.

A new `IllusionManager` (`src/core/illusion.ts`, beside `CrownManager`) owns all of it:

- `apparent(resource)`: real plus conjured. This is what the view shows and what an outsider payment can draw on.
- `spend(resource, amount, context)`: takes conjured units first and moves them to debt, then takes real stock through `add`. It is the single path for the three outsider spenders found in the research: `CrownManager.take`, `DeskManager.applyResources` and `shortfall` (losses only), and `UnlockManager.buy`.
- `conjure(resource, amount)`, `forge(context)`, `back(resource, context)`: the three commands.
- `exposure`, `ceiling`, `room`: coin values. `ceiling` is `ceilingPerPeasant` times the population. Conjuring and forging are refused beyond `room`, with a reason naming the room left. Interest may carry exposure past the ceiling; the ceiling only blocks new illusion.
- `run(context)`: fades `conjured`, grows `debt`, and schedules or lands an audit. It runs after the crown in `StepManager.step`. Fading and interest are plain multiplications, so they are deterministic and use no random stream.

### Audits on the desk

- A new desk kind, `audit`, with its text, option labels and expiry line in `data/desk.json`. It is never eligible for the random draw. `IllusionManager` places it through a new `DeskManager` method when `auditAt` is reached and debt remains. If the debt was repaid during the warning, nothing arrives.
- An audit entry carries `dueAt`. `DeskManager.run` expires an audit at its deadline and exempts it from overflow.
- An audit's options are computed, not template constants: `back` costs each resource's debt in real stock, and `deepen` costs real coin. Both are affordable only from real stock. `DeskManager.settle` and the view ask `IllusionManager` for an audit option's cost and effect, so the existing `settleDispute` command and Court menu work unchanged.
- On failure the auditors seize real stock toward each debt, the debt is cleared, and an uncovered remainder is recorded through a `CrownManager.recordMiss` method that `collect` also uses. The surcharge from an audit is added in coin value to whatever resource the next demand names. That mixing of units is crude and is noted for phase 8.

### Tuning

A new `data/illusion.json`, merged by `loadTuning` and covered by the content hash automatically. Starting values, to be changed only if the simulator check below fails:

| Value | Start | Meaning |
| --- | --- | --- |
| `lot` | 25 | Units conjured per key press in the TUI |
| `ceilingPerPeasant` | 15 | Coin value of illusion plus debt allowed per peasant (300 at promotion) |
| `fadePerTick` | 0.00115 | Conjured stock halves in about one season |
| `interestPerTick` | 0.00016 | Debt grows about 10% per season |
| `audit.debtShare` | 0.5 | Debt worth this share of the ceiling sends auditors |
| `audit.ageTicks` | 2400 | So does any debt this old (four seasons) |
| `audit.warningTicks` | 600 | From the warning to the auditors' arrival |
| `audit.deadlineTicks` | 900 | How long the audit waits on the desk |
| `audit.deepenCost` | 0.2 | Real coin, as a share of the debt's value |
| `audit.deepenGrowth` | 1.5 | Debt multiplier after a deeper illusion |
| `books` | 0.33, 0.66 | Exposure as a share of the ceiling where "thin" becomes "strained" and "strained" becomes "rotten" |

With these numbers, forging a whole first grain demand (300 grain, worth 150 coin) reaches half the ceiling at once, so the first forged quota brings the first audit. That is the exit scenario.

### View

- `LedgerLine.amount` becomes the apparent amount, and gains `conjured`.
- `GameView.illusion` is `IllusionView | null`, null until conjuring is unlocked: `{ books, room, auditInTicks }`, where `auditInTicks` is null unless auditors are on the road.
- `DeskEntryView` gains `ticksLeft: number | null`, set only for an audit.
- `DeskOptionView.affordable` and `ArchiveEntryView.affordable` read `apparent`, except audit options, which read real stock.

PR 1 defines every one of these fields, with the audit fields always null, so PR 2 (core) and PR 3 (TUI) do not touch the same files.

### Save

`SCHEMA_VERSION` 12 with `UPGRADES[11]`: an empty illusion state, and `control.conjuring` granted to a save whose crown has already issued a demand. PR 2 changes the desk entry shape only by adding a new kind, which no version 12 save can contain yet, so it needs no second upgrade.

## PRs

```
main
 └─ illusion-core (PR 1)
     ├─ illusion-audits (PR 2, core only)
     └─ illusion-tui (PR 3, TUI only)
```

PR 2 and PR 3 run in parallel after PR 1. Phase 6 tried the same shape and had to restack because both branches edited `frame()`. Here PR 2 touches only `src/core`, `src/runner`, `data` and `strategies`, and PR 3 only `src/tui`, with the shared view shape fixed in PR 1. PR 1 goes first because it carries the two real unknowns: the shared spend path and whether the model reads well in the ledger.

### PR 1: `illusion-core` (from `main`)

- `src/core/illusion.ts`: `IllusionState`, `emptyIllusionState()`, `IllusionManager` with `apparent`, `spend`, `conjure`, `forge`, `back`, `exposure`, `ceiling`, `room`, and `run` (fade and interest only). Composed on `Game` like the other managers.
- Route `CrownManager.take`, `DeskManager.applyResources` and `shortfall`, and `UnlockManager.buy` through `spend` and `apparent`. Gains still use `add`.
- `CrownManager.issue` grants `CONJURING` on the first demand. `forge` adds to `demand.delivered` and, when it completes the demand, takes the same path as a full delivery.
- Commands `conjure { resource, amount }`, `forge {}` and `back { resource }` in `src/core/commands.ts`, each rejected with a reason before the unlock.
- `data/illusion.json`, its schema in `src/core/tuning.ts`, and `loadTuning` in `src/save/content.ts`.
- `debt` in `QUANTITIES` and `ConditionManager.quantityOf`.
- The view fields above. Validation in `src/core/validate.ts`: conjured and debt are finite and not negative, and only grain and coin can be conjured.
- `UPGRADES[11]` and schema 12, tested with a version 11 save that has an open demand.
- `src/runner/sim.ts` reports `illusion: { conjured, debt, peakDebt }`.
- Tests, each paired with its negative: conjured grain pays the crown and becomes debt, and does not feed peasants; conjuring past the room is refused; a forged report completes a demand and earns the reward; `back` clears debt from real stock only; conjured stock fades and debt grows by the tuned fractions; the Archive and a merchant accept conjured coin.
- Golden: the hash will change for the new state. The run never promotes, so no behavior in it should change; any other difference is a bug to explain.

Acceptance: `bun run check` passes; a simulator run of the crown-aware strategy is unchanged in met and missed counts, since it never conjures.

### PR 2: `illusion-audits` (from `illusion-core`, parallel with PR 3)

- Audit scheduling and landing in `IllusionManager.run`; `view.illusion.auditInTicks`.
- The `audit` desk kind: `dueAt` on the entry, placement outside the random draw, deadline expiry, exemption from overflow, computed options, and `DeskEntryView.ticksLeft`. Text in `data/desk.json`.
- `CrownManager.recordMiss`, shared with `collect`. The `audits` counters.
- `sim.ts` reports the audit counters.
- Two strategies and a gate in `src/runner/strategies.test.ts`: `strategies/conjurer.json` forges every demand and never backs, and must end with at least one failed audit and more missed demands than crown-aware; `strategies/borrower.json` forges and then backs, and must fail no audit. This is a sanity check that repayment matters, not the phase 8 balance pass.
- Tests: an audit is announced at the debt share and at the age; repaying during the warning cancels it; backing clears the debt; a deeper illusion costs real coin and multiplies the debt; expiry seizes, clears and records a miss only when stock falls short; an audit survives desk overflow.

Acceptance: `bun run check` passes and the gate holds on seeds 1, 7 and 42 at 36,000 steps.

### PR 3: `illusion-tui` (from `illusion-core`, parallel with PR 2)

- Ledger: apparent amounts, the conjured share beside a row that has one, and the "Books:" line. The Ledger becomes focusable with `l` once conjuring is owned: j/k selects a resource, enter conjures one lot of grain or coin, `b` backs the selected resource.
- Crown panel: `f` forges a report beside enter to deliver.
- Command line verbs `conjure <resource> <amount>`, `forge` and `back <resource>`, suggested only once conjuring is owned.
- Notices: conjuring unlocked, auditors on the road, and the audit's arrival and failure through the existing desk notices. Court shows an audit's time left.
- Help: an Illusion topic built from tuning.
- Tests for the `l` gating, a conjure and a back from the Ledger, a forge from the Crown, the Books line at each word, each notice firing once, and verb gating.
- tmux check at 100×30 and 160×45 on a scratch save (`STEWARD_SAVE_DIR=$(mktemp -d)`), with captures in the PR.

Acceptance: `bun run check` passes. PR 3 can render the audit fields only as far as PR 1 defines them; the audit's time left in Court is verified after PR 2 merges.

### After the PRs

- [ ] Garret's exit playtest: conjure or forge to meet a quota early, face the audit, back it.
- [ ] Handoff, and the plan flipped to `completed`.

## Review patterns

Carried from phase 6:

- Logic lives in classes, and saved state uses sentinels rather than `null`.
- A golden change is a bug to explain, not a fixture to refresh.
- Every manual TUI run uses `STEWARD_SAVE_DIR=$(mktemp -d)`.
- PRs merge on GitHub with merge commits. For a stack, retarget the next PR to `main` before merging it.
- Plan excerpts are specs. Their bullet and shorthand style must not leak into code comments.

## Risks

- **Illusion-first spending can surprise.** A player who conjured a little grain and then delivers real grain takes on debt for the conjured part. The conjured share on the Ledger row is the mitigation; the playtest decides whether it is enough.
- **Apparent grain while peasants starve.** The Ledger total includes grain nobody can eat. The same conjured share is the mitigation.
- **Laundering through merchants.** Conjured grain sold to a merchant returns real coin. This is the intended loan ("funding expansion ahead of production"), bounded by the ceiling, but it is the likeliest thing for phase 8's balance pass to tighten.
- **Mixed units in the audit surcharge.** A coin-value surcharge lands on a demand in another resource.
- **The numbers are untested.** Only the conjurer and borrower gate guards them until phase 8.

## Notes and decisions

- 2026-11-11: Garret asked for the Crown panel to be hidden until unlocked. Implemented on `hide-locked-crown`, refactor pass done, PR #10 opened.
- 2026-11-11: Garret chose outsiders-only spending, reports as forged deliveries, seizure plus a missed-demand mark for a failed audit, and a debt ceiling as the limit.
- 2026-11-11: Garret approved the PR breakdown and every lead default. PR 1 dispatched on `illusion-core`. The phase 6 playtest question is still unanswered.
