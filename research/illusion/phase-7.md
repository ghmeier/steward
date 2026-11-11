---
title: "Phase 7 research: what illusion, debt and audits build on"
status: draft
tags: [phase-7]
created: 2026-11-11
updated: 2026-11-11
---
# Phase 7 research: what illusion, debt and audits build on

## Question

Phase 7 of the development plan is "Illusion, debt and audits (crude). Conjuring grain, coin and reports, decay, debt growth, audits on the desk and the always-on crude debt signal. This is the hook, so it comes as soon as there are quotas and shocks to use it against; balance waits for the systems built after it. Exit: in a play session, a player conjures to meet a crown quota early, then faces an audit and has to back it."

What exists on `main` (2353397) that phase 7 builds on, what has to change, and which decisions are Garret's?

Continues [[plan/crown/phase-6]], whose exit playtest is still unrecorded.

## Findings

### 1. What the source docs fix

From the game design doc ("Resources and illusion"):

- The steward conjures illusory grain, coin or favorable reports, then spends or presents them as real. The gap between appearance and reality is tracked as illusion debt.
- Uses: meeting a crown quota early, smoothing a bad harvest, funding expansion ahead of production.
- Unbacked illusions fade gradually, and the debt grows the longer it goes unbacked. Never an instant game over.
- Large or long-standing debt triggers an audit, which arrives on the desk with warning. Passing requires backing the illusions with real resources, or a convincing and costly deeper illusion.
- Leverage should pay off only with a plan to repay it.

From the development plan ("Architecture"):

- The state holds true values only. Everything the player sees passes through the computed view: truth plus illusion. The TUI never reads truth directly. Debt and audits are calculated from the gap.
- A crude debt signal is always visible. The Archive sells precision, and that precision is phase 8 ("Archive precision upgrades"), along with illusion's first real balance pass.
- Illusion debt is posting state and resets at prestige.
- Offline decay and debt growth on real time belong to phase 10.

### 2. Where resources are spent today

Every spend writes `posting.resources` directly through `add` (`src/core/math.ts`). There is no shared "pay" path. The spenders are:

| Spender | Code | Direction |
| --- | --- | --- |
| Upkeep and famine | `EconomyManager.run` (`src/core/economy.ts`) | inside the village |
| Decree sells and feeding | `EconomyManager.sellResource`, `feedGrain` | inside the village (the market is a price, not a party) |
| Crown delivery and collection | `CrownManager.take` (`src/core/crown.ts`) | to an outsider |
| Desk options and expiry | `DeskManager.applyResources`, affordability in `shortfall` (`src/core/desk.ts`) | to an outsider |
| Archive purchases | `UnlockManager.buy` (`src/core/unlocks.ts`) | to an outsider |

The three outsider spenders each compare a cost to `posting.resources[resource]` and then subtract. If illusion is to be spendable there, those three need one shared path that knows about conjured stock. The two village-internal spenders run every tick inside `StepManager.runFlows`, which the ledger's rate projection (`src/core/projection.ts`) also runs, so touching them is the costlier change.

### 3. The view boundary already exists

`ViewManager.compute` (`src/core/view.ts`) builds `ledger` from `posting.resources`, and its comment says the view may differ from the truth without touching a renderer. Affordability shown to the player is also computed there (`DeskOptionView.affordable`, `ArchiveEntryView.affordable`). Showing apparent amounts is a change inside `compute` and its helpers only.

Decree conditions read true stock through `ConditionManager.quantityOf` (`src/core/conditions.ts`). Runner strategies react through the same conditions, so a strategy can only react to illusion or debt if a quantity exposes it, as `owed*` does for the crown.

### 4. The desk can carry an audit, with two gaps

`DeskManager` (`src/core/desk.ts`) draws a kind by weight on a shared random arrival timer, and an entry leaves only when the player settles it or when the desk overflows its three slots.

- **Arrival.** An audit is caused by debt, not drawn at random. It needs a way onto the desk outside `drawKind`.
- **Deadline.** Overflow expiry depends on later random arrivals (1.5 to 3 minutes each), so an audit could sit for five to nine minutes, or be pushed out early by a merchant. An audit needs its own deadline. No entry has a `dueAt` today.
- **Options.** `DeskOption` effects are fixed resource amounts, a grudge and a newcomer. Backing a debt costs an amount that depends on state, so an audit's options are computed, not template constants.
- **Reusable.** Slots, the `settleDispute` command, `DeskEntryView`, the Court menu, arrival and expiry notices (`src/tui/desk-notices.ts`), and `FrameResult.expired` for flavor lines.

### 5. The crown gives illusion its first target

`CrownManager.deliver` pays from stock toward the open demand and rewards a full early payment with 10% of the amount in coin. `collect` at the deadline seizes stock and records met or missed. In the phase 6 simulator gate the crown-aware strategy met every demand and the reference strategy missed most ore, wood and coin demands, so there is a real shortfall for illusion to cover. The crown asks for all four resources, but the design doc lists only grain and coin as conjurable, plus "reports".

### 6. Unlocks, notices, save and runner

- Unlocks granted through play are data (`play` in `data/archive.json`, a condition per unlock), except `CROWN_PANEL`, which `StepManager.checkPromotion` grants directly. Conjuring can be gated either way.
- Notices are derived by comparing consecutive views (`src/tui/crown-notices.ts`), in a fixed priority order in `frame()`.
- A save change needs `SCHEMA_VERSION` 12 and an `UPGRADES[11]` step (`src/save/save.ts`). Saved state cannot hold `null`, so absent values use sentinels.
- `RNG_STREAMS` is fixed at creation. A new stream needs the upgrade step to seed it. Decay and debt growth must not use the RNG.
- The runner (`src/runner/sim.ts`, `strategy.ts`) replays commands and reactions, and `src/runner/strategies.test.ts` holds the phase 6 gate. Phase 8's exit is "illusion pays off only when the strategy repays it", so phase 7 should leave the runner able to conjure and report debt, without having to balance it.

### 7. The Crown panel when locked

`createPanels` (`src/tui/panels.ts`) always builds the bottom row as Court, Decrees and Crown, and draws "Locked." in any panel listed in `view.lockedPanels`. Garret asked on 2026-11-11 for the Crown panel not to be drawn until it is unlocked. That change is independent of phase 7 and was dispatched on its own branch, `hide-locked-crown`.

## Sources

- Development plan: https://claude.ai/artifact/W1LESSbnonaotUx1qEu93J (read 2026-11-11, revision 30).
- Game design doc: https://claude.ai/artifact/NgCC6Q1LNo423bMujycHiV (read 2026-11-11, revision 57).
- Code on `main` at 2353397: `src/core/{crown,desk,economy,unlocks,view,conditions,step,state}.ts`, `src/tui/{panels,keys,village-panels}.ts`, `src/runner/strategy.ts`, `data/{crown,archive,tuning}.json`.

## Open questions

For Garret:

1. **What conjured stock can do.** Spendable only on outsiders (crown, desk, Archive), or everywhere including feeding peasants and decree sells?
2. **What a conjured report is in phase 7.** A forged delivery record against the open demand in any resource, or deferred to phase 8 with governor reports?
3. **What failing an audit costs**, given favor does not exist until phase 8.
4. **What limits conjuring**: a ceiling on outstanding debt, a coin cost per conjuring, or interest alone.
5. **Whether the phase 6 playtest happened**, and whether it calls for tuning before phase 7 builds on the crown numbers.

Lead defaults to confirm with the plan: conjuring unlocks through play when the first crown demand is issued; conjured stock is spent before real stock; the crude signal is a word on the Ledger ("The books are clean / thin / strained / rotten"); debt is tracked per resource and can be read by decrees and strategies as one `debt` quantity.
