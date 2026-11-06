---
title: "Phase 6 research: the desk and crown demands today"
status: final
tags: [phase-6]
created: 2026-11-06
updated: 2026-11-06
---
# Phase 6 research: the desk and crown demands today

## Question

Phase 6 is "Desk and crown demands. Desk slots, random arrivals, expiry defaults and periodic quotas, with event content in data files. Exit: shocks force decree retuning in a full play session." What exists today that phase 6 builds on, what must change, and which decisions only Garret can make?

Line references are to `main` at 39d3e2d. All measured numbers below were taken on that commit with `bun run sim` (seed 1 unless stated, 36,000 ticks). One tick is 100 ms, so 600 ticks are one minute, one season is one minute (`ticksPerSeason: 600`), and one year is four minutes.

## Findings

### 1. The desk today

**State.** `Dispute` is `{ id, template, parties: [number, number], arrivedAt }` and `DeskState` is `{ nextDisputeId, nextArrivalTick, disputes }`, oldest first (`src/core/desk.ts:10-22`). It lives at `posting.desk` (`src/core/state.ts:33`). The Zod schema is `dispute` and `desk` in `src/core/validate.ts:81` and `:103-111`; it checks ascending ids against `nextDisputeId`, that both parties are distinct living peasants (`validate.ts` `rosterIssues`, around line 154), and that `arrivedAt` is not after the current tick (`tickBoundIssues`, around line 168).

**Arrival timing.** `drawArrivalDelay` draws a delay uniformly in `[minTicks, maxTicks]` from `tuning.village.disputeArrival`, which is 900 to 1,800 ticks (1.5 to 3 minutes) in `data/village.json` (`desk.ts:25-28`). `Game.create` draws the first arrival tick at creation (`src/core/game.ts:71-92`). In `DeskManager.run`, when `tick >= nextArrivalTick` a dispute is drawn only if at least two peasants live, but the next arrival tick is drawn either way, so an arrival with fewer than two peasants is skipped rather than postponed (`desk.ts:175-179`).

**Random stream.** The desk draws from `posting.rng.disputes` (`desk.ts:54-58`). Each dispute draws, in order, the template index, the first party and the second party (`desk.ts:144-164`), and then the next arrival delay. `RNG_STREAMS` is `["disputes", "names"]` (`state.ts:44`). Each stream is seeded independently from the posting seed and its name with FNV-1a and splitmix32 (`src/core/rng.ts:36-66`), so adding a stream does not change the draws of the others.

**Expiry.** After an arrival, while the desk holds more than `deskSlots` (3) entries, the oldest is removed and its template's `expiry` option is applied with losses clamped to what the village holds (`desk.ts:181-188`, clamping in `applyResources` at `desk.ts:92-105`). Because arrival runs before the overflow check, the fourth dispute pushes out the oldest on the tick it arrives. Before arrival, disputes whose party has died are dropped with no effect (`desk.ts:170-173`). The desk runs once per step after the economy and decrees and before promotion and unlocks (`src/core/step.ts:47-50`). There is no flavor line on expiry and no notice on arrival or expiry in the TUI; the design doc's "line of flavor" does not exist yet.

**Rulings, options and grudges.** `settle` rejects an unknown dispute or option, rejects an option the village cannot afford (`shortfall`, `desk.ts:80-90`), applies the option's resources through `add`, and grudges the named party until `max(grudgeUntil, tick + grudgeTicks)`, where `grudgeTicks` is 600 (one season) (`desk.ts:107-142`). A grudged peasant produces nothing and refuses a job.

**Content.** `data/village.json` holds the names, `deskSlots: 3`, `promotionPopulation: 20`, `disputeArrival`, `grudgeTicks` and six dispute templates. Each template has `text`, two or more `options` (`id`, `label`, optional `resources` of coin, grain, ore and wood, optional `grudge` of `first` or `second`) and an `expiry` option id. The schema is in `src/core/tuning.ts:78-123`. It enforces that `expiry` names an option, that the expiry option does not grudge, and that it does not gain any resource. Text placeholders are limited to `{first}` and `{second}` (`tuning.ts:21-27`). `loadTuning` merges `tuning.json`, `village.json` as `village`, and `archive.json` as `archive` (`src/save/content.ts:8-16`). The content hash covers every file in `data/`, so a new data file is picked up automatically. Option costs are small: coin from −3 to −8, grain from −3 to −12, wood −4 to −6, and fines of +3 and +6 coin.

**Command.** `settleDispute { dispute: number, option: string }` is in the command schema (`src/core/commands.ts:23-27`) and dispatches to `desk.settle` (`commands.ts:83-88`). There is no `settle` verb on the command line; the verbs are decree, repeal, buy, save, enact, forget and assign (`src/tui/command-line.ts:633-681`).

**View.** `DeskEntryView` is `{ id, label, parties, options }` and `DeskOptionView` is `{ id, label, affordable, expiry, resources, grudge }` (`src/core/view.ts:14-30`). `deskEntries` fills names into the text and throws if a party is not in the roster (`view.ts:160-186`).

**TUI.** The Court panel is a `MenuPanel` whose root is `courtMenu` (`src/tui/village-panels.ts:155-164`, generic `MenuPanel` at `:117-153`). Unfocused, it lists dispute texts or "The desk is clear." Focused with `c` (`src/tui/keys.ts:37`), j/k selects, enter opens the options screen (`src/tui/court-menu.ts:26-60`), and enter on an option enqueues `settleDispute`. Option labels show the cost, who will sulk and "(the default if ignored)" (`court-menu.ts:16-24`). Unaffordable options are disabled. Help explains disputes from the tuning numbers (`src/tui/help-menu.ts`, `disputeLines`, around line 195).

**What a multi-kind desk needs.**

- The entry shape hard-codes two parties and a dispute template. A general entry needs a `kind`, a template id within that kind, `arrivedAt`, and kind-specific fields (parties for disputes; perhaps nothing for a merchant or a crown herald).
- Template lookup (`templateOf`, `desk.ts:60-70`) searches only `village.disputes`. It needs to look up by kind, and the content needs a place per kind (a new `data/desk.json`, or more arrays in `village.json`).
- Eligibility is dispute-specific: "at least two peasants" in `run`, and dropping an entry whose party died. Each kind needs its own eligibility and staleness rule.
- Placeholders are limited to `{first}` and `{second}`, and the option effect vocabulary is resources plus a grudge. New kinds will want new effects (for example a temporary production bonus, a peasant arriving, or a quota change).
- The view, `courtMenu` and the Court panel's wording ("Hold court", "Settle the dispute", "No disputes wait on the desk") assume disputes.
- Field names in state (`nextDisputeId`, `disputes`) and the command (`settleDispute`, `dispute`) would be renamed only with a save upgrade and a command-log change; keeping the old names and adding a `kind` avoids both.
- A single arrival timer is shared today. Either all kinds share it and the kind is drawn on arrival, or each kind has its own timer.

**Reusable as is.** The arrival delay draw, the slot and overflow loop, `shortfall`, `applyResources` with clamped losses, the expiry rules in the schema (no gain, no grudge), the `MenuPanel` and `menu.ts` screen stack, and the shape of the settle command.

### 2. Crown placeholders

- `CROWN_PANEL = "panel.crown"` (`src/core/unlocks.ts:24`). It is not in `data/archive.json`, so nothing can grant it. The phase 5 plan says its unlock trigger belongs to phase 8 (`plan/unlocks/phase-5.md`, scope and line 57).
- `CrownDemandView = { label: string }` (`view.ts:39`) and `GameView.crown: CrownDemandView | null` (`view.ts:56`), which is always `null` (`view.ts:129`). Phase 2 reserved exactly this, commented "null until phase 6" (`plan/tui/phase-2.md:70-77`). `src/tui/panels.test.ts:73` builds a view with `crown: null`.
- `PanelId` is `"archive" | "ledger" | "peasants"` (`view.ts:38`). The layout overhaul removed `crown`, and its plan says "Phase 6 adds `crown` back" (`plan/tui/village-layout.md:56`). `lockedPanels` reports only `archive` until it opens (`view.ts:141`).
- The promotion notice reads "The crown has noticed you. You are promoted to steward." (`src/tui/app.ts:233-236`), and Help says "Reach 20 peasants and the crown notices you." (`help-menu.ts:209`).
- `career.followers` and `career.formerStaff` exist and are unused (`state.ts:17-18`). There is no favor field anywhere.
- Nothing named quota or favor exists in `src/` or `data/`.

### 3. The economy

**Resources and rates.** The resources are coin, grain, ore and wood (`src/core/realm.ts:2`). From `data/tuning.json`, a farmer makes 0.025 grain a tick times the season yield (spring 1, summer 1.5, autumn 1, winter 0), a forester 0.02 wood, and a miner 0.01 ore (`src/core/economy.ts:129-157`). Every peasant eats 0.01 grain a tick. Per minute that is about 15 grain from a farmer in spring and autumn, 22.5 in summer and none in winter (13 on average over a year), 12 wood from a forester, 6 ore from a miner, and 6 grain eaten by each peasant. Prices are grain 0.5, wood 0.5 and ore 1 coin, so a forester or a miner is worth about 6 coin a minute.

**How coin is earned.** Only two ways: a `sell` policy on the harvest, wood or ore petition (`src/core/decree-engine.ts:150-163`, `economy.ts:159-172`), and the two dispute fines (+6 and +3). A bare "resource above N" rule sells everything above N; any other rule sells only this tick's production (`decree-engine.ts:173-188`). So a village selling ore never holds more ore than its threshold.

**Growth and famine.** Feeding puts grain into a growth store; 25 grain makes a peasant, up to 40 (`economy.ts:174-188`). A famine kills at most half the village, spread over a season (`economy.ts:113-127`).

**The Archive.** It opens when coin is first above 0 (`data/archive.json`, `play`). Prices are palette 100, saved decrees 250 (needs the palette), compound conditions 400 and chaining 800, 1,550 in all.

**Promotion.** `checkPromotion` sets `career.promotedAt` once, when population first reaches 20, and never clears it (`step.ts:27-34`). Nothing else changes: the TUI shows the notice once, the Ledger shows "Promoted to steward on …" (`village-panels.ts:282-296`), and play continues exactly as before up to 40 peasants.

**Measured pace.**

| Strategy | What it does | Result |
| --- | --- | --- |
| `reference` | Feed above 2 grain seasons, all farm | Promoted about 13.4 min (tuning-pass handoff); 33 peasants at 15 min, 40 at 20 min. Never earns a coin. Grain piles up to 12,400 by 60 min, because feeding does nothing at the cap. |
| Garret's set (phase 5 spike) | Feed above 200 grain, sell wood above 100, sell ore above 50, farm except mine in winter | Stays at one peasant for about 25 min, first coin about 28 min, 40 peasants at 35 min, then about 66 coin a minute, almost all from winter ore. Ore sits at 50. |
| Grow then balance (mine, scratch) | Reference until 20 peasants, then `balanced` labor, sell all wood and ore, sell grain above 3 seasons | 60 to 72 coin a minute at 20 to 25 peasants (seeds 1 and 7). Selling grain above 3 seasons with one peasant sold every surplus for 33 minutes before any growth, the same one-peasant trap the tuning pass found. |

A rough ceiling: a 40-peasant village needs about 19 farmers to eat year round, leaving 21 others worth about 126 coin a minute. So a strategy that sells earns roughly 60 to 70 coin a minute at 20 to 40 peasants, and a player can buy the whole Archive in about 25 minutes of a grown village.

### 4. Decrees

**Petitions.** `harvest` (feed, sell, stockpile), `wood` and `ore` (sell, stockpile) and `labor` (a policy from `laborAllocations`: balanced, farming, farm, forest, mine) (`src/core/decree.ts:8`, `:279-290`, `data/tuning.json`).

**Conditions.** `compare` against a quantity, `season`, `chose` (another decree's policy, needs chaining), and `all`, `any` and `not` (need compound conditions) (`decree.ts:20-31`). The quantities are coin, grain, grainSeasons, idle, ore, population and wood (`decree.ts:10-18`), evaluated in `ConditionManager.quantityOf` (`src/core/conditions.ts:7-22`). Nothing can reference a quota today. Adding a quantity to `QUANTITIES` and `quantityOf` is the extension point. Strategies, play unlocks and tutorial hooks use the same `Condition` type, so a new quantity would also let strategies react to quotas. The command line's compare suggestions and `decree-format.ts` would need to describe it.

**How a quota forces retuning.** Several pressures follow directly from the code:

- An ore quota against the common "farm, mine in winter" labor decree yields ore only one minute in four, and an "ore sell" decree keeps ore at its threshold or at zero. The player must raise or repeal the sell rule and move labor toward the mine outside winter.
- A wood quota hits the reference set hardest, since nobody forests there and wood stays at 0.
- A grain quota competes with feeding (growth) and with winter stores.
- A coin quota competes with the Archive and pushes a player who only feeds toward selling.

Because a labor decree now settles only when its chosen policy changes (`src/core/labor.ts:28-37`), a quota rule written as a labor condition (for example "mine when ore below N") would move peasants on each change of chosen policy, which suits a quota.

### 5. The headless runner and strategies

**Dead time.** A strategy is `{ name, setup, reactions }`. A reaction fires its commands when its condition becomes true (edge triggered) (`src/runner/strategy.ts:66-117`). `stats()` reports setup and reaction command counts, ticks with an action, and the longest quiet stretch (`strategy.ts:17-22`). The reference set acts zero times after setup in 36,000 ticks. Strategies cannot settle disputes, because a reaction cannot name a dispute id; in the runner every desk entry expires on its default.

**`--grant`.** Writes unlock ids into the career at tick 0, only with `--seed` (`src/runner/sim.ts:164-171`).

**Golden run.** `scripts/update-golden.ts` runs seed 42 for 10,000 steps with `test/fixtures/command-log.json` and grants every Archive entry. `test/golden.json` holds the resulting hash, checked in `src/core/determinism.test.ts:163-188`. The fixture settles dispute 1 with option `for-second` at tick 2300. The other determinism tests compare two processes, a save at tick 5,000 and resume, a round trip, and replay (`determinism.test.ts:36-160`).

**Effect of a new system with randomness.**

- The state hash is the canonical save, so any new state field (crown state, a new stream) changes the golden hash. The golden must be re-recorded with an explained diff.
- A new stream in `RNG_STREAMS` does not change the dispute or name draws. `src/core/game.test.ts:23` expects the rng keys to equal `RNG_STREAMS` in order, and `game.test.ts:38` skips `disputes` because it draws at creation; a crown stream that draws at creation must be skipped there too.
- If the generalized desk changes what the disputes stream draws (for example drawing a kind first), dispute 1 in the fixture may become a different template, and `for-second` may not exist, so the tick-2300 command would be rejected. Check that before re-recording.
- Quota deliveries that happen outside `runFlows` will not show in the Ledger's projected rates, which run only the economy and decrees (`step.ts:21-25`). That is the right choice for one-off deliveries.

### 6. Save schema

`SCHEMA_VERSION` is 9 (`state.ts:8`). The Zod state schema is in `src/core/validate.ts` (`posting` around line 196, `career` around 216, `gameState` at 228 with `schemaVersion: z.literal(SCHEMA_VERSION)`). `validateState` also rejects `null` and other non-plain data.

On load, `parseSave` calls `upgrade`, which applies `UPGRADES[version]` steps one at a time, bumping the version after each (`src/save/save.ts:55-76`). The only step is 8 to 9, which adds `posting.labor`. Anything older is refused: the file is kept as `save.v<N>.json` and a new game starts with a notice (`app.ts:49-54`). Phase 6 would bump to 10 and add an `UPGRADES[9]` step that adds empty crown state (and renames desk fields, if they are renamed). State cannot hold `null`, so "no quota" needs a sentinel or an empty record, following `NO_LABOR_POLICY` (`labor.ts:3-7`).

### 7. The TUI

**Layout.** `createPanels` builds two rows: Ledger (weight 1), Peasants (1) and Archive (2) on top, and Court (1) and Decrees (1) below, with a one-line status bar and an absolutely positioned command bar (`src/tui/panels.ts:232-268`). The default design size is 160×45 and the smallest supported is 100×30; the Ledger already drops its Time line at 30 rows. Locked panels show "Locked." (`panels.ts:32`, `:279`).

**Keys.** `FOCUS_IDS` is peasants, archive, court and decrees (`keys.ts:12`). Global keys are p, a, c, d, left, right, :, ?, n, s and q (`keys.ts:34-46`). `c` is taken by Court, so a Crown panel needs another letter or must not be focusable. `FocusRing` steps through owned panels (`keys.ts:49-78`). Panel hints are per `FocusId` (`keys.ts:146-168`).

**Where crown content could go.**

- Split the Archive's double-width slot into Archive and Crown. This keeps two rows.
- Add a third panel to the bottom row (Court, Decrees, Crown).
- Show the current demand as Ledger lines (label, amount held against amount due, time left), like the Promotion line (`village-panels.ts:282-296`). This needs no new panel. The Ledger is already the tightest column at 100×30.

**Notices.** `frame()` sets one message per frame; later checks win: a command rejection, then starvation, then unlocks, then promotion (`app.ts:219-238`). Unlocks use `announceNewUnlocks` with a set of already-seen ids seeded from the loaded state, so a reload never replays them (`src/tui/unlock-notices.ts:14-31`). Promotion uses a flag set from the view on load (`app.ts:94`, `:146`). Starvation compares two views (`src/tui/starvation-notice.ts`). The status bar cuts the end of a long notice (`panels.ts:102-143`). Crown notices (a new demand, a deadline near, met or missed) and desk notices (arrival, expiry flavor) fit the view-diff pattern of starvation or the seen-set pattern of unlocks.

### 8. Gotchas

- Always run the TUI with `STEWARD_SAVE_DIR=$(mktemp -d)`. The TUI ignores `XDG_DATA_HOME` on macOS, and an implementer's run once overwrote Garret's real save.
- Nothing happens while the game is closed. Game time is the tick count, and the clock drops time beyond `maxStepsPerFrame` into `droppedMs` for phase 10 (`src/clock.ts:44-50`). Deadlines measured in ticks therefore pause while the player is away, with no extra work.
- `canonicalStringify` and state validation refuse `null`. `GameView.crown` may stay nullable because views are never serialized canonically.
- `templateOf` throws when a saved entry names a template that was removed from the data (`desk.ts:60-70`). New content files carry the same risk for crown templates.
- `sampleVillage` in `test/helpers.ts` grants every Archive unlock; gating tests use `createNewGame`.
- `Game.fromState` draws nothing; `repealStale` runs on load in both the TUI and the runner.
- `wt merge` squashes under "Squash commits from <branch>"; amend the message after merging.
- The disputes stream drew one arrival at creation; any crown stream drawn at creation changes `game.test.ts` expectations.

## Sources

- Code: `src/core/{desk,state,rng,game,step,commands,tuning,economy,decree,decree-engine,conditions,labor,unlocks,view,validate}.ts`, `src/save/{save,content}.ts`, `src/runner/{sim,strategy}.ts`, `src/tui/{app,panels,keys,village-panels,court-menu,unlock-notices,starvation-notice,help-menu,command-line}.ts`, `src/clock.ts`, `data/*.json`, `strategies/*.json`, `scripts/update-golden.ts`, `test/golden.json`, `test/fixtures/command-log.json`.
- Docs: [[handoff/unlocks/phase-5-done]], [[handoff/village/phase-4-done]], [[plan/village/phase-4]], [[plan/tui/village-layout]], [[research/tui/village-layout]], [[plan/mechanics/labor-phase-changes]], [[handoff/mechanics/tuning-pass-done]], [[plan/unlocks/phase-5]], [[plan/tui/phase-2]], [[plan/decrees/phase-3]].
- Measurements: `bun run sim --seed 1 --steps 36000 --strategy <file> --trace …` with `strategies/reference.json` and two scratch strategies (Garret's set from the phase 5 spike, and grow then balance), seeds 1 and 7.

## Open questions

1. **Cadence and mix.** How often does the crown demand, how long does the player have, and which resources? A single resource per demand (simple, and it forces one labor shift) or a basket? Do amounts scale with population or rise with each demand met?
2. **Cost of failure before favor exists.** Favor is phase 8. Until then a missed quota needs some cost: a coin fine, seizing stores, a fixed penalty such as lost peasants, or only a recorded tally that phase 8 converts to favor.
3. **When quotas start.** In the village phase from the first minutes, after some population, or only after promotion? Today promotion changes nothing, and the reference strategy is promoted at about 13 minutes and full at 20, so post-promotion quotas would be the first thing promotion does.
4. **Delivery.** Is a quota taken automatically when the deadline arrives, or delivered by a player command? Phase 7's conjuring needs a moment to meet a quota early, which suggests a `deliver` command (and verb), with automatic collection at the deadline as the fallback.
5. **Random or scheduled.** Are quota amounts, resources and intervals drawn from a new `crown` stream, or fixed in data? Random demands are better shocks; a fixed schedule is easier to balance and to teach.
6. **Quotas on the desk or beside it.** Is a crown demand a desk entry (it can expire, take a slot and have options) or its own panel with one demand at a time?
7. **New desk kinds to ship first.** For example a merchant offering a trade, a traveller who joins the village, or a crown herald announcing a demand. Which effects do they need beyond resources and grudges?
8. **Can decrees read quotas?** Adding quantities such as "quota amount due" or "ticks until the deadline" lets a decree, and the runner's strategies, react to a demand. Should that be free, or an Archive purchase?
9. **Where the Crown shows.** A sixth panel (which slot, and which key, since `c` is Court), or Ledger lines.
10. **Desk expiry flavor and notices.** The design doc wants a line of flavor on expiry, and nothing shows arrivals or expiries today. Should expiry options gain a flavor text, and should arrivals and expiries post a notice?
