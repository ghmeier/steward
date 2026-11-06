---
title: "Phase 6: crown quotas and a desk with more than disputes"
status: active
tags: [phase-6]
created: 2026-11-06
updated: 2026-11-06
next_step: PR 1 crown-core in progress (implementer dispatched)
---
# Phase 6: crown quotas and a desk with more than disputes

Research: [[research/crown/phase-6]]. Sources: the development plan (phase 6, "Desk and crown demands") and the game design doc's sections on the desk and the crown. Continues [[handoff/unlocks/phase-5-done]], [[plan/tui/village-layout]] and [[plan/mechanics/labor-phase-changes]].

## Goal

Promotion starts the crown's demands. The crown asks for one resource at a time with a deadline, and that demand is the shock that forces the player to retune their decrees. The desk grows beyond disputes into a few event kinds that arrive at random, and an event that expires resolves with a line of flavor.

Exit (from the development plan): in a full play session, shocks force decree retuning. In the runner, a strategy that never changes its decrees after promotion misses quotas, and one that reacts to them meets them.

## Decisions

Garret, 2026-11-06:

- **Start.** Quotas begin at promotion. Promotion grants the Crown panel, and the first demand arrives shortly after. Nothing changes before 20 peasants.
- **Missing a quota.** At the deadline the crown seizes what stock it can toward the amount still owed. A surcharge on the remaining shortfall is added to the next demand. Each demand is recorded as met or missed, which phase 8 turns into crown favor.
- **Delivery.** A `deliver` command pays from stock at any time before the deadline. A demand paid in full before its deadline earns a small coin reward. Anything still owed at the deadline is collected automatically.
- **Placement.** The bottom row becomes Court, Decrees and Crown at 1 : 1 : 1. The Crown panel's letter is `r`, shown as "C(r)own".

Lead defaults, for Garret to confirm or change with the plan:

- **Cadence and mix (default).** One resource per demand, drawn from a new `crown` RNG stream, never the same resource twice in a row. The amount, the deadline and the gap before the next demand come from `data/crown.json`. Amounts rise by a fixed step for each demand met, so a strong village is pushed harder. Starting numbers, to be tuned against the simulator in PR 1: the first demand 1 minute after promotion, a 3-minute deadline (long enough to cross a season), a gap of 2 to 4 minutes after each demand resolves, base amounts of 300 grain, 150 wood, 80 ore or 100 coin, rising 20% per demand met, a 50% surcharge on a shortfall, and a reward of 10% of the amount in coin for early delivery.
- **Partial delivery (default).** `deliver` hands over whatever stock is on hand, up to the amount owed, so a player can pay in installments. The reward needs the full amount before the deadline.
- **Decrees can read the demand (default).** A new Archive entry, "Crown correspondence" (300 coin), adds one quantity per resource to decree conditions: `owed ore`, `owed wood`, `owed grain` and `owed coin`. Each is the amount still owed on the current demand when the demand is for that resource, and 0 otherwise. This lets a player write "stockpile ore while owed ore > 0" or "mine while owed ore > 0". It is a coin sink that competes with the quota itself, which is the tension the handoff asked for.
- **New desk kinds (default).** Two kinds beside disputes. A *merchant* offers to buy a resource above the market price or sell one below it (resources-only effects, so no new effect vocabulary). A *traveller* asks to settle in the village for some grain, and accepting adds one peasant (one new effect, `newcomer`). Both expire to "the merchant moves on" or "the traveller walks on", with no gain.
- **Notices (default).** A new demand, the deadline drawing near (one season left), and a demand met or missed each post a notice. A desk arrival and an expiry post a notice too, and the expiry notice is the event's flavor line.

## Approach

### The crown in the core (`src/core/crown.ts`, new)

- State: `posting.crown = { demand, nextDemandTick, met, missed, surcharge }`. `demand` is `{ id, resource, amount, delivered, issuedAt, dueAt }`, or the sentinel `NO_DEMAND` between demands, following `NO_LABOR_POLICY` in `src/core/labor.ts`, because saved state cannot hold `null`. `nextDemandTick` stays at a sentinel until promotion.
- A `CrownManager` class, shaped like `DeskManager` in `src/core/desk.ts`: `run(tick)` issues a demand when `promotedAt` is set and `tick >= nextDemandTick`, and resolves the demand at `dueAt` (seize, record, surcharge, draw the next gap). `deliver()` moves stock into `delivered` and pays the reward when the demand is full before its deadline. Seizure clamps to stock with the same rule as `applyResources` in `desk.ts`; reuse it rather than writing another.
- `step.ts` runs the crown after the desk and before the promotion check, so the tick that promotes schedules the first demand and the demand cannot be issued and resolved in one step.
- Command: `deliver {}` in `src/core/commands.ts`. It is rejected with a clear reason when no demand is open or the village holds none of the resource.
- RNG: `RNG_STREAMS` gains `crown`. It draws nothing at creation, so `game.test.ts` needs no new skip.
- Content: `data/crown.json`, loaded as `tuning.crown` by `src/save/content.ts`, with its Zod schema in `src/core/tuning.ts`. Each resource has a base amount and a herald line ("The crown requires 300 grain for the garrison."), plus missed and met lines.
- Quantities: The four `owed <resource>` quantities join `QUANTITIES` in `src/core/decree.ts` and `ConditionManager.quantityOf` in `src/core/conditions.ts`, gated by the new Archive entry `CROWN_CORRESPONDENCE` in `data/archive.json` and `src/core/unlocks.ts`.
- `CROWN_PANEL` is granted by promotion: the unlock registry already supports play-triggered unlocks (the Archive opens at first coin), so add a `play` condition on `population >= promotionPopulation`, or have `checkPromotion` grant it, whichever the registry makes simpler.
- Save: `SCHEMA_VERSION` 10, with `UPGRADES[9]` in `src/save/save.ts` adding an empty crown (and the panel unlock for a save already promoted, with the first demand one minute after load).
- View: `CrownDemandView` in `src/core/view.ts` grows from `{ label }` to the resource, amount, delivered, ticks left, the herald line, and the met and missed tally. `PanelId` gets `crown` back.
- Runner: strategies can name `deliver` in a reaction, and `--grant` covers the new entry. Add `strategies/crown-aware.json` (reference plus "deliver when stock covers the amount owed" and a labor rule on `owed ore`) beside the unchanged `reference.json`.

### The Crown in the TUI

- `src/tui/panels.ts`: the bottom row becomes Court, Decrees and Crown at 1 : 1 : 1. The Crown panel shows "Locked." until promotion.
- A `CrownPanel` in `src/tui/village-panels.ts` following the existing focusable panels. Unfocused: the herald line, `ore 45 / 80` with a bar, and "due in 1m 20s"; between demands, "The crown is quiet. Next demand in about 2m." and the tally "Met 3 · missed 1". Focused (`r`): enter delivers, with the hint `enter deliver · esc back`.
- `keys.ts`: `r` focuses the Crown. `FOCUS_IDS` and `FocusRing` include it once owned.
- Command line: a `deliver` verb in `src/tui/command-line.ts`, and the `owed <resource>` quantities in the compare suggestions and `decree-format.ts`.
- Notices: a `crown-notices.ts` in the view-diff pattern of `starvation-notice.ts`, comparing two views for a new demand, one season left, met and missed. It slots into `frame()` in `app.ts` with the existing priority order (rejection, starvation, crown, unlocks, promotion).
- Help: a Crown topic and the `r` key.

### A desk with event kinds

- Keep the state field names (`disputes`, `nextDisputeId`) and the `settleDispute` command, so the command log and existing saves need no rename. Each entry gains `kind: "dispute" | "merchant" | "traveller"`, and `parties` becomes optional, present only for disputes. A schema bump adds `kind: "dispute"` to existing entries on load.
- Content moves from `village.disputes` to `data/desk.json`, keyed by kind. Each template keeps `text`, `options` and `expiry`, and gains an `expired` flavor line. The existing schema rules (the expiry option exists, gains nothing and grudges no one) apply to every kind.
- One shared arrival timer. On arrival the kind is drawn first, from the kinds eligible now (disputes need two living peasants; a traveller needs the village below its population cap), weighted by data. Drawing the kind first changes the disputes stream's sequence, so check that the golden fixture's `settleDispute` at tick 2300 still names a valid option before re-recording; if not, update the fixture's option, and say so in the PR.
- Staleness by kind: a dispute is dropped when a party dies; other kinds never go stale.
- The `newcomer` effect adds a peasant through the same path as birth in `economy.ts`, so naming and the labor-decree placement rule from [[plan/mechanics/labor-phase-changes]] apply.
- The Court panel and `court-menu.ts` drop dispute-only wording ("Hold court", "No disputes wait") for wording that covers every kind. Expiry posts its `expired` line as a notice, and arrival posts the event's first line.

## PRs

Crown balance carries the most uncertainty, so it goes first and headless, measured in the simulator before any UI. PR 2 and PR 3 both build on PR 1 and can run in parallel.

```
main
 └─ crown-core (PR 1)
     ├─ crown-panel (PR 2)
     └─ desk-kinds (PR 3)
```

### PR 1: `crown-core` (from `main`)

The crown's demands in the core, the `deliver` command, the Archive entry and quantities, schema 10, and runner support.

- [ ] `src/core/crown.ts` with `CrownManager`, state, sentinel and schema; `step.ts` ordering; `deliver` command.
- [ ] `data/crown.json`, its tuning schema, and `CROWN_CORRESPONDENCE` with the `owed` quantities.
- [ ] `CROWN_PANEL` granted at promotion; `CrownDemandView` and `PanelId` `crown` in the view (the TUI ignores it until PR 2, apart from the type).
- [ ] `UPGRADES[9]` with a test that a promoted version 9 save loads with the panel and a first demand scheduled.
- [ ] Tests, each one invariant: no demand before promotion; the first demand one minute after promotion; never the same resource twice in a row; partial delivery; full early delivery pays the reward and resolves at once; a miss seizes stock clamped to zero, records the miss and surcharges the next demand; a met demand raises the next amount; `deliver` rejected with no demand open; `owed ore` is 0 for a wood demand.
- [ ] Golden re-recorded, with the diff explained in the PR (new state fields and the crown stream; the fixture promotes before tick 10,000 only if it does today, so say which).
- [ ] Simulator evidence in the PR: `reference.json` and `crown-aware.json`, seeds 1, 7 and 42, 36,000 ticks. Report demands met and missed for each, and the tick of each. Tune `data/crown.json` until the unchanged reference misses at least half and the crown-aware strategy meets most. If no tuning gets there, stop and report rather than forcing it.

### PR 2: `crown-panel` (from `crown-core`)

The Crown panel, its key and notices, the `deliver` verb and Help.

- [ ] Bottom row of three, Crown locked until promotion, focus with `r`, enter delivers.
- [ ] `deliver` verb and `owed <resource>` suggestions on the command line.
- [ ] Crown notices in `frame()`.
- [ ] Help topic and key.
- [ ] Tests in `app.test.ts` and the panel's test file: `r` does nothing before promotion; enter in the focused Crown enqueues `deliver`; the bottom row splits in thirds within the layout test's 2-column tolerance; each notice fires once from a view pair.
- [ ] A tmux check at 100×30 and 160×45 on a scratch save (`STEWARD_SAVE_DIR`) promoted with the simulator, with screenshots or captured panes in the PR.

### PR 3: `desk-kinds` (from `crown-core`)

The desk generalized to kinds, merchants and travellers, expiry flavor and desk notices. It includes its Court panel changes, so the new kinds are playable when it lands.

- [ ] `kind` on entries, `data/desk.json`, kind-first draw, eligibility and staleness by kind, the `newcomer` effect.
- [ ] Schema 11 with `UPGRADES[10]` adding `kind: "dispute"`.
- [ ] Court wording for every kind, arrival and expiry notices.
- [ ] Tests: a merchant expires with no gain; accepting a traveller adds a named peasant who follows the labor-decree placement rule; a traveller is not drawn at the population cap; a dispute is still dropped when a party dies; an expiry posts its flavor line.
- [ ] Golden re-recorded with the fixture check described above.

PR 3 bumps the schema after PR 1. If PR 2 and PR 3 finish together, merge PR 2 first; they touch different TUI files apart from `app.ts`'s `frame()`, where both add a notice.

### After the PRs: the playtest

Garret plays a full session from a fresh village through at least four demands. That session is the phase's exit check. Findings go into Notes and decisions, and a tuning PR follows if needed.

## Review patterns

From earlier phases, for implementers and the refactor pass:

- Logic lives in classes (`CrownManager` beside `DeskManager`), and saved state uses sentinels rather than `null`.
- A golden change is a bug to explain, not a fixture to refresh.
- Every manual TUI run uses `STEWARD_SAVE_DIR=$(mktemp -d)`. Never touch the real save.
- `wt merge` squashes under "Squash commits from <branch>". Amend the message on main after each merge.
- Plan excerpts are specs. Their bullet and shorthand style must not leak into code comments.

## Risks

- **Quotas may not force retuning.** If a sell-everything village can always cover a demand, the shock is decorative. PR 1's simulator gate exists to catch this before any UI is built.
- **Quotas may be impossible.** An ore demand in a village with no miners and a 3-minute deadline may be unmeetable without the Archive entry. The crown-aware strategy shows whether a reacting player can meet it; if not, lengthen the deadline rather than shrink amounts.
- **The desk's draw order changes.** Drawing a kind first shifts every later dispute, which can break the golden fixture's dispute command. PR 3 checks it explicitly.
- **The Ledger and Crown at 100×30.** A third bottom panel is about 32 columns wide at 100 columns, enough for the demand lines, but the herald line will wrap.

## Notes and decisions

- 2026-11-06: Garret chose promotion as the start, seizure plus a surcharge and a record for misses, early delivery with automatic collection, and the bottom-row Crown panel on `r`.
- 2026-11-06: Garret approved the PR breakdown and every lead default. PR 1 dispatched.
