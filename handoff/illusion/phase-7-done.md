---
title: "Phase 7 merged: conjuring, forged reports, debt and audits"
status: picked-up
tags: [phase-7]
branch: main
created: 2026-11-11
updated: 2026-11-11
---
# Phase 7 merged: conjuring, forged reports, debt and audits

## Context

Phase 7 of the development plan ("Illusion, debt and audits (crude)") is merged to `main` at 81d5171. `bun run check` passes there with 992 tests in about 3 seconds. Continues [[plan/illusion/phase-7]], with research in [[research/illusion/phase-7]].

The phase's exit is a play session in which the player conjures to meet a crown quota early, then faces an audit and backs it. Garret is running that playtest himself and will raise anything it finds as separate follow-up tasks, so the plan is closed without waiting on it. The same applies to the phase 6 playtest in [[plan/crown/phase-6]].

## Done

### What we built

**Illusion is credit against the truth.** `posting.resources` is still the real stock, and the per-tick economy, decree flows and the ledger's rate projection read only that. `posting.illusion` sits beside it:

- `conjured`: illusory grain and coin in the stores. It fades by `fadePerTick` each tick (about half per season).
- `debt`: per resource, what was passed off as real. It grows by `interestPerTick` each tick (about 10% per season).
- `debtSince` and `auditAt`: ticks, with 0 standing for "none".
- `audits`: counts of audits backed, deepened and failed.

**Only outsiders accept illusion.** The crown, desk offers and the Archive are paid through `IllusionManager.spend`, which uses conjured stock first and turns it into debt, then real stock. Peasants cannot eat conjured grain and decrees cannot sell it.

**Three commands.** `conjure { resource, amount }` adds illusory grain or coin. `forge {}` marks what is still owed on the open crown demand as delivered on paper, in any resource, and the forged amount becomes debt; completing a demand this way earns the early-delivery reward. `back { resource }` repays one resource's debt from real stock.

**A ceiling.** Conjured stock plus debt, valued in coin at market prices, cannot pass `ceilingPerPeasant` times the population (300 at promotion). Interest can carry it over; the ceiling only blocks new illusion.

**Audits.** Debt worth half the ceiling, or any debt four seasons old, announces auditors. One season later an `audit` entry lands on the desk with its own deadline of a season and a half, and overflow never pushes it out. The player can back the debt from real stock, or pay real coin worth 20% of the debt for a deeper illusion that multiplies the debt by 1.5. At the deadline the auditors seize real stock toward the debt, clear it, and any uncovered remainder counts as a missed crown demand with a surcharge. Repaying everything during the warning means nobody arrives; repaying while the audit waits passes it.

**Unlock.** `control.conjuring` is granted when the crown issues its first demand. It is not sold in the Archive.

**On screen.** The Ledger shows apparent amounts, the conjured share on an indented line under a row that has one, and "Books: clean / thin / strained / rotten". Exact debt appears only in an audit's options. The Ledger is focusable on `l` once conjuring is owned (enter conjures one lot, `b` repays). `f` in the Crown panel forges. The Crown panel is no longer drawn before promotion.

### Key files

| File | What it holds |
| --- | --- |
| `src/core/illusion.ts` | `IllusionState`, `IllusionManager`: `apparent`, `spend`, `conjure`, `forge`, `back`, `ceiling`, `room`, `books`, `debtValue`, audit scheduling in `run`, and `auditCost`, `settleAudit`, `failAudit` |
| `src/core/desk.ts` | `DRAWN_KINDS` for the random draw, the `audit` kind with `dueAt`, `placeAudit`, `removeAudit`, `deltasOf` |
| `src/core/crown.ts` | `credit` (shared by a delivery and a forged report), `recordMiss` (shared by a missed collection and a failed audit), the conjuring grant in `issue` |
| `src/core/economy.ts` | `priceOf`, the one price lookup used to value illusion in coin |
| `src/core/view.ts` | `LedgerLine.conjured`, `GameView.illusion`, `DeskEntryView.ticksLeft` |
| `src/core/step.ts`, `src/core/errors.ts` | `StepOptions.validateEvery`, `StepManager.validate`, `InvalidStateError` |
| `data/illusion.json`, `data/desk.json` | Illusion tuning; the audit templates |
| `src/save/save.ts` | Schema 12 and `UPGRADES[11]` |
| `src/runner/sim.ts` | The `illusion` summary (conjured, debt, peak debt, audit counts) and `--validate-every` |
| `strategies/conjurer.json`, `strategies/borrower.json` | The two strategies behind the repayment check in `src/runner/strategies.test.ts` |
| `src/tui/village-panels.ts`, `src/tui/panels.ts` | The focusable `LedgerPanel`, `f` on `CrownPanel`, `VillagePanel.hiddenWhileLocked` |
| `src/tui/keys.ts`, `src/tui/command-line.ts` | `l` gated on conjuring; the `conjure`, `forge` and `back` verbs |
| `src/tui/audit-notices.ts`, `src/tui/unlock-notices.ts`, `src/tui/court-menu.ts`, `src/tui/help-menu.ts` | The audit warning, the conjuring notice, time left and rounded costs in Court, the Illusion help topic |

### PRs

| PR | Branch | Merge commit | What it did |
| --- | --- | --- | --- |
| #10 | `hide-locked-crown` | d753c80 | The Crown panel is not drawn until it is unlocked |
| #11 | `illusion-core` | 8135192 | Illusion state and manager, the shared payment path, the three commands, the ceiling, the unlock, schema 12, the `debt` quantity, the view fields |
| #12 | `illusion-tui` | 1196e44 | The focusable Ledger, forging from the Crown, verbs, notices, Help |
| #13 | `illusion-audits` | eab6317 | Audits on the desk, failure as a missed demand, the conjurer and borrower strategies |
| #14 | `court-cost-rounding` | e4ddf7c | Court rounds fractional costs up to one decimal |
| #15 | `sim-validate-interval` | 81d5171 | The simulator validates once per season, cutting `bun run check` from 36 seconds to under 4 |

### How it was verified

- Simulator, 36,000 steps on seeds 1, 7 and 42: the conjurer (forges everything, never repays) failed 8, 9 and 7 audits and missed 6, 8 and 7 demands. The borrower (forges grain demands, repays) and crown-aware (never conjures) failed none and missed none.
- One audit run end to end in the real game on a scratch save: arrival with its time left, backing shown unavailable without the real stock, lapse, debt cleared, "Met 1 · missed 1".
- The golden hash changed only because the state gained a field.

## In progress

Nothing.

## Next steps

1. Garret's exit playtest for phase 7, and the phase 6 one. Findings arrive as separate tasks.
2. Phase 8 in the development plan: promotion, governors and favor, with illusion's first real balance pass and the Archive selling debt precision.

## Gotchas

- **The first forged quota brings an audit.** A 300 grain demand is worth 150 coin, which is exactly half the ceiling at 20 peasants. This is deliberate for the exit scenario and is the first number phase 8 should revisit.
- **Not exercised by play or by the simulator:** backing an audit and the deeper illusion have unit tests only. No strategy settles an audit, because a strategy cannot know a desk entry's id.
- **The simulator does not show illusion paying off.** The borrower does no better than crown-aware. Phase 8's exit asks for that.
- **Illusion is spent first.** A player holding a little conjured grain who delivers real grain takes on debt for the conjured part.
- **The Ledger total can include grain nobody can eat.** The conjured line under the row is the only signal.
- **Conjured grain sold to a merchant returns real coin.** This is the intended loan, bounded by the ceiling, and the likeliest thing for balance to tighten.
- **An audit's surcharge mixes units.** It is a coin value added to the next demand, whatever resource that demand names.
- **`recordMiss` adds to the surcharge** instead of replacing it, so an audit failed during an open demand is not overwritten when that demand is collected.
- **The desk runs before the illusion manager in a step.** An audit therefore lapses only while debt remains, so a repayment on the deadline tick still passes.
- **The `debt` decree quantity is ungated** and reveals the exact figure the Ledger hides. It is a candidate for an Archive gate in phase 8.
- **Notice priority:** the conjuring notice outranks the first demand's herald in the bar, and a save loaded with auditors already on the road shows no warning, because notices never replay on load.
- **Help:** the desk topic does not mention audits (the Illusion topic does), and the Keys list names panels the player does not own yet.
- **Simulator validation is periodic.** A failure is reported at the next season boundary or at the end of the run; rerun with `--validate-every 1` for the first invalid tick. The TUI session and one long step test still validate every step.
- **Small leftovers:** `forge` reads the crown demand directly and casts its resource; `UPGRADES[11]` casts crown fields instead of validating them; `LedgerPanel` and `DecreesPanel` each clamp their own selection index; the runner's `--grant` cannot grant conjuring.
- Every manual TUI run uses `STEWARD_SAVE_DIR=$(mktemp -d)`. Six merged worktrees remain beside the repo (`steward.hide-locked-crown`, `steward.illusion-core`, `steward.illusion-tui`, `steward.illusion-audits`, `steward.court-cost-rounding`, `steward.sim-validate-interval`).
