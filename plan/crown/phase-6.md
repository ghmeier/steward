---
title: "Phase 6: crown quotas and a desk with more than disputes"
status: active
tags: [phase-6]
created: 2026-11-06
updated: 2026-11-06
last_pr: 9
next_step: Garret playtests from a fresh village through four demands; findings go into Notes, then a tuning PR if needed and the handoff
---
# Phase 6: crown quotas and a desk with more than disputes

Research: [[research/crown/phase-6]]. Sources: the development plan (phase 6, "Desk and crown demands") and the game design doc's sections on the desk and the crown. Continues [[handoff/unlocks/phase-5-done]], [[plan/tui/village-layout]] and [[plan/mechanics/labor-phase-changes]].

## Status

All three PRs are merged to `main` (2353397, 907 tests). What remains is the exit check: Garret's playtest from a fresh village through at least four demands, then a tuning PR if the playtest calls for one, then the handoff. The plan stays `active` until then.

| PR | Branch | Merge commit | What it did |
| --- | --- | --- | --- |
| #7 | `crown-core` | 65abcc4 | Crown demands in the core, `deliver`, collection at the deadline, Crown correspondence, schema 10, the crown-aware strategy |
| #8 | `crown-panel` | b552712 | Crown panel on `r` in the bottom row, crown notices, the `deliver` verb, gated `owed*` suggestions, Help topic |
| #9 | `desk-kinds` | 2353397 | Desk event kinds (merchant, traveller), `data/desk.json`, expiry flavor, arrival and expiry notices, schema 11 |

## Goal

Promotion starts the crown's demands. The crown asks for one resource at a time with a deadline, and that demand is the shock that forces the player to retune their decrees. The desk grows beyond disputes into a few event kinds that arrive at random, and an event that expires resolves with a line of flavor.

Exit (from the development plan): in a full play session, shocks force decree retuning. In the runner, a strategy that never changes its decrees after promotion misses quotas, and one that reacts to them meets them. The runner half is met (see PR 1); the play session is the outstanding playtest.

## Decisions

Garret, 2026-11-06:

- **Start.** Quotas begin at promotion. Promotion grants the Crown panel, and the first demand arrives one minute later. Nothing changes before 20 peasants.
- **Missing a quota.** At the deadline the crown collects what stock it can toward the amount still owed. If stock covers it, the demand counts as met, with no reward and no surcharge (lead decision, following from automatic collection). If not, it is missed, and half the uncovered amount is added to the next demand. Each demand is recorded as met or missed, which phase 8 turns into crown favor.
- **Delivery.** A `deliver` command pays from stock at any time before the deadline, in installments if stock is short. A demand paid in full before its deadline earns a coin reward of 10% of the amount.
- **Placement.** The bottom row is Court, Decrees and Crown at 1 : 1 : 1. The Crown panel's letter is `r`, shown as "C(r)own".

Lead defaults, approved by Garret with the plan:

- **Cadence and mix.** One resource per demand, drawn from the `crown` RNG stream, never the same resource twice in a row. `data/crown.json` holds the numbers, unchanged from the starting values because the simulator gate passed without tuning: first demand 600 ticks after promotion, deadline 1,800 ticks, gap 1,200 to 2,400 ticks after each demand resolves, base amounts of 300 grain, 150 wood, 80 ore or 100 coin, rising 20% per demand met, a 50% surcharge on a shortfall, and a 10% early-delivery reward.
- **Decrees can read the demand.** The Archive entry Crown correspondence (`decree.crownCorrespondence`, 300 coin) unlocks the decree quantities `owedOre`, `owedWood`, `owedGrain` and `owedCoin`. Each is the amount still owed when the current demand is for that resource, and 0 otherwise.
- **New desk kinds.** A merchant offers to buy a resource above the market price or sell one below it. A traveller asks for grain to settle, and accepting adds one peasant (the `newcomer` effect). Both expire with no gain.
- **Notices.** A new demand, one season left, and a demand met or missed each post a notice. A desk arrival posts the event's first line, and an expiry posts its flavor line.

## As built

### The crown in the core

- `src/core/crown.ts`: `CrownManager`. State is `posting.crown = { demand, nextDemandTick, met, missed, surcharge, lastResource }`. `demand` uses the `NO_DEMAND` sentinel between demands, and `nextDemandTick` a sentinel until promotion, because saved state cannot hold `null`. The demand id is `met + missed + 1`, so no counter is stored.
- `run()` issues a demand at `nextDemandTick` and calls `collect()` at `dueAt`. `deliver()` and `collect()` both take stock through one private `take` method using `add`; neither needed the desk's clamping, because both already limit what they take to what the village holds.
- `StepManager.checkPromotion` grants `CROWN_PANEL` and calls `CrownManager.scheduleFirstDemand()`. The crown runs after the desk and before the promotion check.
- `deliver {}` is in `src/core/commands.ts`, rejected with a reason when no demand is open or the village holds none of the resource.
- `drawDelay(stream, range)` in `src/core/rng.ts` is shared by the desk, `Game.create` and the crown's gap between demands.
- `OWED_RESOURCES` in `src/core/decree.ts` maps each `owed*` quantity to its resource. `DECREE_GATES` in `src/core/unlocks.ts` maps gated decree features to their Archive entries, and the Archive tuning schema requires every gate's entry to exist.
- Save: `SCHEMA_VERSION` 10 with `UPGRADES[9]` in `src/save/save.ts`. It adds an empty crown and the `crown` stream, and for a promoted save grants the panel and schedules the first demand 600 ticks after load. It reads `firstDemandTicks` through `loadTuning()`, because `parseSave` takes only the save text.
- View: `GameView.crown` is `CrownView | null`, null until promotion. `CrownView` is `{ demand: CrownDemandView | null, nextDemandTicks, met, missed }`, and `CrownDemandView` is `{ resource, amount, delivered, ticksLeft, herald }`. `PanelId` includes `crown`.
- Runner: strategies can use `deliver` in reactions. `strategies/crown-aware.json` needs `--grant decree.crownCorrespondence`. It delivers installments above fixed stock thresholds, because a reaction can only compare a quantity to a constant. `sim.ts` reports `promotedAt` and `crown: { met, missed, outcomes }`.

### The Crown in the TUI

- `src/tui/panels.ts`: bottom row Court, Decrees and Crown at 1 : 1 : 1. Every panel title goes through `titleWithKey`.
- `CrownPanel` in `src/tui/village-panels.ts`: the herald line (wrapped), `ore 45 / 80` with no bar because the TUI has no bar helper, "due in 1m 20s", or "The crown is quiet. Next demand in about 2m." between demands, and the tally "Met 3 · missed 1". Focused with `r`, enter enqueues `deliver`, and a rejection shows in the bar.
- `src/tui/keys.ts`: `r` is gated on `CROWN_PANEL`, and the Crown is in `FOCUS_IDS`, the focus ring and the hints.
- `src/tui/command-line.ts`: a bare `deliver` verb (a `bare` flag on `Verb`, carried to choices as `final`). The `owed*` suggestions appear only once Crown correspondence is owned. Without it, typing one gives a problem line naming the entry.
- `src/tui/crown-notices.ts`: `crownNotice` compares consecutive views, so a reload never replays a notice. The missed notice names the demand's full amount, because collection at the deadline happens between views.
- `src/tui/help-menu.ts`: a Crown topic built from tuning.

### A desk with event kinds

- `src/core/desk.ts`: entries are a discriminated union on `kind` (`DESK_KINDS`: dispute, merchant, traveller), with `parties` only on disputes. The state field names (`disputes`, `nextDisputeId`) and the `settleDispute` command are unchanged.
- `data/desk.json` owns `slots`, `arrival`, `grudgeTicks` and `kinds`, each with a `weight` and `templates`. Disputes have six templates (weight 3), merchants three (weight 2) and travellers two (weight 1). Every template has an `expired` flavor line. The option schemas share one base in `src/core/tuning.ts`, and `DeskOption` and `DeskTemplate` are inferred from them.
- On arrival the kind is drawn first by weight from the kinds eligible now (disputes need two living peasants, travellers need room), then the template, then dispute parties. Only disputes go stale.
- `EconomyManager.admitNewcomer()` is the single path for births and travellers, so naming and the labor-decree placement rule apply. `EconomyManager.hasRoom` is the one population-cap check. A traveller's option is unaffordable when the village is full.
- Expiry lines are not saved. `DeskManager.expired` holds the step's lines and is cleared each step, `Session.frame()` collects them into `FrameResult.expired` like rejected commands, and `src/tui/desk-notices.ts` combines them with the arrivals found by comparing views.
- Court wording covers every kind ("The desk", "Decide", "Nothing waits on the desk."). Help's desk topic walks the tuning's kinds.
- Save: `SCHEMA_VERSION` 11 with `UPGRADES[10]` adding `kind: "dispute"`.

### Notice priority

In `frame()` a later check overrides an earlier one. The code order is rejection, starvation, desk, crown, unlocks, promotion. A crown notice therefore outranks a desk notice, and an unlock notice outranks a crown notice: a delivery that earns the village's first coin shows "The Archive opens" instead of the met line.

## PRs

The plan had PR 2 and PR 3 in parallel from `crown-core`. Both touched `frame()`, so `desk-kinds` was rebased onto `crown-panel` and the three merged as one stack, each retargeted to `main` before merging.

```
main
 └─ crown-core (PR #7)
     └─ crown-panel (PR #8)
         └─ desk-kinds (PR #9)
```

### PR 1: `crown-core`, PR #7, merged 65abcc4

- [x] `CrownManager`, state, sentinels and schema; step ordering; `deliver` command.
- [x] `data/crown.json`, its tuning schema, and Crown correspondence with the `owed*` quantities.
- [x] `CROWN_PANEL` granted at promotion; `CrownView` and `PanelId` `crown`.
- [x] `UPGRADES[9]`, tested with a promoted version 9 save.
- [x] Crown tests, consolidated from 17 to 10 in the refactor pass.
- [x] Golden re-recorded. The golden run (seed 42, 10,000 steps) never promotes, so no demands appear in it. The hash changed for the crown state, the `crown` stream and the granted entry.
- [x] Simulator gate, 36,000 steps, starting numbers with no tuning. Reference met 2, 3 and 2 and missed 6, 5 and 6 on seeds 1, 7 and 42; it meets only the grain demands its stock covers. Crown-aware met 13, 12 and 13 and missed none. Two tests in `src/runner/strategies.test.ts` assert the gate.

### PR 2: `crown-panel`, PR #8, merged b552712

- [x] Bottom row of three, Crown locked until promotion, focus with `r`, enter delivers.
- [x] `deliver` verb and gated `owed*` suggestions.
- [x] Crown notices in `frame()`.
- [x] Help topic and key.
- [x] Tests for `r` gating, delivery, the thirds layout, each notice firing once, and suggestion gating.
- [x] tmux check at 100×30 and 160×45 on scratch saves; captures are in the PR.

### PR 3: `desk-kinds`, PR #9, merged 2353397

- [x] `kind` on entries, `data/desk.json`, kind-first draw, eligibility and staleness by kind, the `newcomer` effect.
- [x] Schema 11 with `UPGRADES[10]`.
- [x] Court wording for every kind, arrival and expiry notices, and a test that a crown notice outranks a desk notice in the same frame.
- [x] Tests for merchants, travellers, the population cap, stale disputes and expiry flavor.
- [x] Golden re-recorded. The kind-first draw made the fixture's first desk entry a traveller, so the fixture's tick-2300 command now admits it (option `admit`) instead of settling a dispute. Dispute settling stays covered by unit tests.

### After the PRs: the playtest

- [ ] Garret plays a full session from a fresh village through at least four demands. Findings go into Notes and decisions.
- [ ] A tuning PR, if the playtest calls for one.
- [ ] The handoff, and the plan flipped to `completed`.

Things to watch in the playtest: whether demands force a decree change, whether they are too easy once the player reacts (crown-aware paid its first demand about 100 ticks after it was issued), whether merchants and travellers arrive often enough to matter, and whether the notices read well in the bar.

## Review patterns

- Logic lives in classes (`CrownManager` beside `DeskManager`), and saved state uses sentinels rather than `null`.
- A golden change is a bug to explain, not a fixture to refresh.
- Every manual TUI run uses `STEWARD_SAVE_DIR=$(mktemp -d)`. Never touch the real save.
- PRs are merged on GitHub with merge commits (`gh pr merge --merge`). For a stack, retarget the next PR to `main` with `gh pr edit <n> --base main` before merging it.
- Plan excerpts are specs. Their bullet and shorthand style must not leak into code comments.

## Follow-ups left out of phase 6

- Derive key bindings in `keys.ts` from a `key` field on each panel, so a title's letter and its binding share one source.
- Put an unlock requirement on each decree quantity, instead of the `owed` special case in the command line.
- Pass tuning into `parseSave` so `UPGRADES[9]` stops reading the default data directory.
- Travellers have no `{name}` placeholder, because the newcomer's name is drawn at settle time.
- A progress bar helper for the TUI, for the Crown panel and anything else that shows progress.

## Risks

- **Quotas may still be too easy for a reacting player.** The simulator gate shows a decree-blind village fails, but crown-aware never missed. The playtest decides whether amounts or deadlines need tightening.
- **The Archive notice hides the first met notice** for a player whose first coin is the early-delivery reward. The panel's tally still shows it.

## Notes and decisions

- 2026-11-06: Garret chose promotion as the start, seizure plus a surcharge and a record for misses, early delivery with automatic collection, and the bottom-row Crown panel on `r`.
- 2026-11-06: Garret approved the PR breakdown and every lead default. PR 1 dispatched.
- 2026-11-06: PR 1 implemented on `crown-core` (881fe4f). The simulator gate passed with the starting numbers. Deviations: camelCase quantities, promotion granting the panel directly, a stored `lastResource`, and the `CrownView` shape.
- 2026-11-06: Lead decision. A demand fully collected from stock at the deadline counts as met, with no reward and no surcharge, because Garret chose automatic collection. Only a shortfall is a miss (098c243).
- 2026-11-06: PR #7 opened after the refactor pass (5be17ca). The refactor shared `drawDelay`, added `DECREE_GATES` and `OWED_RESOURCES`, and kept `UPGRADES[9]` reading `loadTuning()`, because passing tuning through `parseSave` touches about 15 call sites. PR 2 and PR 3 dispatched in parallel from `crown-core`.
- 2026-11-06: PR 2 implemented on `crown-panel` (1a55fd2). Lead decisions: the missed notice names the demand's full amount, and unlock notices keep their place above crown notices.
- 2026-11-06: PR #8 opened after the refactor pass (772000a). PR 3 implemented on `desk-kinds` (c8f5214) with a saved `desk.lastExpired` and the fixture changed to admit a traveller. Lead decision: rebase `desk-kinds` onto `crown-panel` so the three PRs form one stack, with desk notices below crown notices.
- 2026-11-06: PR #9 opened against `crown-panel` after the rebase and refactor pass (2c38624). The refactor removed the saved `desk.lastExpired` in favor of `FrameResult.expired`, so two expiries in one frame both show.
- 2026-11-06: PR #7, #8 and #9 merged to `main` in order at Garret's request (main 2353397). `bun run check` passed on `main` locally with 907 tests. Awaiting the exit playtest.
