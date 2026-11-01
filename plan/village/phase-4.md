---
title: "Steward: Phase 4 implementation plan (village phase)"
status: completed
tags: [phase-4, village]
created: 2026-10-28
updated: 2026-11-01
---
# Steward: Phase 4 implementation plan (village phase)

Phase 4 turns the headless village into a bare but playable game: named peasants the player assigns by hand, disputes that arrive on a small desk, a promotion target, and a plain decree menu in the TUI. Builds on [[plan/decrees/phase-3]] and its handoff [[handoff/decrees/phase-3-done]].

## What the development plan says

Source: the claude.ai "Steward: Development Plan" doc, build order item 4, and the "Village phase" paragraph of the game design doc.

- **Village phase.** Built as the general engine at small scale. Peasants and governors share one delegate abstraction, and the screen is the main layout with most panels still locked, so the village isn't separate code. Decrees are entered through a plain menu here; the type-ahead builder replaces it in phase 5.
- **Exit:** a player can assign named peasants, settle disputes and reach the promotion target.
- The game is playable, if bare, from the end of phase 4.
- Game design doc: the steward starts as a village reeve with a few named peasants and a ledger, delegates from the first minute by assigning individuals to tasks and settling small disputes, and reaching a population target triggers a one-time promotion. Desk events wait until the desk is full, after which the oldest expire with a mediocre default and a line of flavor, never a disaster.

## Scope and exit criteria

In scope: a roster of named peasants as the source of truth for population and labor; manual assignment of a selected peasant; a village desk of disputes with random arrivals, player rulings, grudges and expiry defaults; dispute and name content in a data file; a one-time promotion flag; a locked crown panel; a decree menu that enacts rules with one condition each and repeals decrees.

Out of scope: governors (phase 8, but the delegate record leaves room), the unlock registry and type-ahead (phase 5), crown quotas and the general desk (phase 6), favor, anything that promotion unlocks (phase 8), balance.

Exit criteria:

1. In the TUI, a player can select a named peasant and move them between farm, forest, mine and idle, settle a dispute by picking an option, enact a decree with conditions from the menu, and repeal it. Checked by hand in tmux.
2. Promotion fires once when population first reaches the target, is kept if population later falls, and is shown in the TUI.
3. In the runner, the reference strategy reaches the promotion target within ten years with disputes expiring on their defaults, and still loses no peasants.
4. Every dispute effect goes through `add`; replaying a recorded log reproduces the same state hash; `bun run check` passes.

## Lead decisions (2026-10-28, confirmed with Garret)

Garret picked these four on 2026-10-28:

- **The roster is the truth.** Each peasant is a delegate record. Population and labor counts are derived from the roster; the `population` and `labor` fields leave `EconomyState`. Governors reuse the record in phase 8 (`kind` widens).
- **Disputes change resources and cause grudges.** A dispute names two peasants. A ruling may cost or pay resources and may give one party a grudge, during which that peasant stays assigned but produces nothing.
- **Promotion is a tuned target and a flag only.** Nothing changes at promotion until phase 8.
- **The decree menu builds rules with one condition each** (a compare or a season), up to `maxRules`, plus the otherwise policy. `chose`, `all`, `any` and `not` stay runner-only until phase 5.

Decided by the lead on Garret's behalf (confirm on return):

- **Promotion target is 20 peasants.** Pacing spike on main (seed 1, reference strategy from tick 1): 15 at 9.8 minutes, 20 at 17.5, 25 at 21.9, 30 at 26.1, 40 at 33.7. A learning player is slower than the reference, so 20 lands near the 15 to 25 minute aim. Re-measured after disputes landed (main 732b328, reference strategy, checked every 100 ticks): 17.5 to 17.7 minutes with disputes expiring, and 18.0 to 19.0 minutes with a scripted judge grudging someone in every dispute (seeds 1, 7, 42). The target stays 20.
- **Delegates are an array in id order**, not a record, so iteration order is birth order without zero-padded keys. Ids are positive integers from a counter that never reuses an id.
- **Names are drawn from the `names` RNG stream**, uniformly among names no living peasant holds, so living peasants never share a name. The name list must be at least `maxPopulation` long (checked when tuning loads). Names never affect production, so the "core production numbers never use the RNG" rule holds.
- **Which peasant moves or dies is fixed:** labor decrees take the lowest-id idle peasant, else the lowest-id peasant in the job with the largest excess. Starvation kills the lowest-id idle peasant, else the lowest-id peasant in mine, then forest, then farm.
- **`assignPeasant` replaces `assignWorker`.** `f`, `w`, `m` and `i` assign the selected peasant to farm, forest, mine or idle; the cursor is TUI state, not game state.
- **Village content lives in `data/village.json`** (names, dispute templates, desk and promotion numbers) and loads as `tuning.village`. The core still receives it as an argument.
- **Disputes are the village desk**, not the general desk: phase 6 generalizes slots, arrivals and expiry to other event kinds. Expiry happens only when the desk overflows, as the design doc says. A dispute whose party dies is dropped with no effect.
- **A grudged peasant refuses to be given a job** (added after the step 2a review found that grudging an idle peasant was free, and every game starts all-idle). `assignPeasant` to a job is rejected while `tick < grudgeUntil`; assigning to idle is allowed. Labor decrees skip grudged peasants as movers (lowest-id ungrudged idle, else lowest-id ungrudged in the job with the largest excess, else no move that tick). A grudged worker keeps the job and produces nothing.
- **Dispute content gives real tradeoffs:** the village gains resources only from a fine or fee; the fair option costs stores and grudges nobody; grudging rulings are free or cost a little.
- **A ruling the village cannot afford is rejected.** An expiry default never is: its resource losses are clamped to what the village holds.
- **The crown panel is locked** in the village; the governors panel becomes the peasants panel. The view lists locked panels; phase 5 moves that list into the unlock registry.
- **No `null` in state** (the validator rejects it): idle is the job `"idle"`, and "not promoted" is `promotedAt: 0`.
- **Schema version** goes to 4 with the roster, 5 with disputes and 6 with promotion. Older saves are refused, as before.
- **The menu edits the decree for a petition by replacing it**, keeping the active decree's id if there is one and using the petition name otherwise, so it never creates a second decree for a petition.

## Spike (lead, done)

`/tmp/steward-phase4/pacing.ts` ran the reference strategy on main for 24,000 ticks and printed the first tick at each population (numbers in the promotion decision above).

## Delegates and the roster (step 1)

`src/core/delegates.ts` (new):

```ts
export type Delegate = {
	id: number;
	name: string;
	kind: "peasant";
	job: Job | "idle";
	grudgeUntil: number; // the peasant produces nothing while state.tick < grudgeUntil; 0 = no grudge
};
```

- `posting.delegates: Delegate[]`, ascending by id; `posting.nextDelegateId: number`, greater than every id ever used.
- `EconomyState` becomes `{ hunger, growth, starved }`. Helpers: `population(state)`, `laborCounts(delegates): Record<Job, number>`, `idleCount(delegates)`, and `workingCounts(delegates, tick)` which leaves out peasants with a grudge. Production uses `workingCounts`; upkeep, labor targets and decree quantities use the roster as is.
- A new game holds `initialPopulation` idle peasants, ids 1 to N, names drawn in id order.
- `assignPeasant { peasant: number; job: Job | "idle" }` is rejected for an unknown peasant, when the peasant already has that job, or (from step 2a) when a grudged peasant is given a job.
- View: `delegates: { id, name, job, grudgeTicks }[]` in id order, and `decrees: Decree[]` (copies, sorted by id) so the TUI can show and edit them. `realm` keeps population, idle, labor and season.

## Disputes (step 2a)

- `posting.desk = { nextDisputeId, nextArrivalTick, disputes: Dispute[] }`, `Dispute = { id, template, parties: [number, number], arrivedAt }`, oldest first.
- Templates in `data/village.json`: `{ id, text, options: { id, label, resources?, grudge?: "first" | "second" }[], expiry: optionId }`, where `text` and `label` may use `{first}` and `{second}` for the parties' names.
- Each step, after the economy and decrees: drop disputes whose party has died; then if `tick >= nextArrivalTick` and at least two peasants live, draw a template and two distinct parties from the `disputes` stream, append it, and draw the next arrival tick; then if the desk holds more than `deskSlots` disputes, the oldest resolves with its expiry option.
- `settleDispute { dispute: number; option: string }` applies the option's resource changes through `add` (rejected if any resource would go negative) and its grudge (`grudgeUntil = max(grudgeUntil, tick + grudgeTicks)`), then removes the dispute.

## Promotion and layout (step 3)

- `career.promotedAt: number` (0 until promotion, which can only happen at tick 1 or later), set at the end of the first step whose population is at least `village.promotionPopulation`. Never cleared.
- View: `promotion: { target, promotedAt }` and `lockedPanels: PanelId[]` (`["crown"]` in phase 4).
- TUI: the ledger shows progress toward promotion, the footer announces it once, the crown panel reads as locked, and a court key opens the dispute menu built in step 2b.

## Decree menu (step 2b)

A pure, renderer-free menu state machine in `src/tui/menu.ts` (a stack of list screens plus a numeric field), reused by step 3 for disputes. `d` opens the decree menu: active decrees with a one-line summary, enact a decree for a petition (add rules, set otherwise, enact), and repeal. While a menu is open, game keys are off except Ctrl-C.

## Task order

| Step | Branch | Depends on | Files owned |
| --- | --- | --- | --- |
| 1 roster | `roster` | main | `src/core/{delegates (new),economy,state,commands,decree-engine,step,tuning,validate,view}.ts`, `data/village.json` (new, names only), `src/save/content.ts`, `src/tui/{keys,panels,app}.ts`, `src/runner/*`, tests, fixtures, golden |
| 2a disputes | `disputes` | 1 merged | `src/core/{desk (new),state,step,commands,tuning,validate,view}.ts`, `data/village.json`, core tests, golden; no `src/tui` |
| 2b decree menu | `decree-menu` | 1 merged | `src/tui/{menu,decree-menu (new),keys,app,panels}.ts`, TUI tests; no `src/core` |
| 3 promotion | `promotion` | 2a and 2b merged | core promotion, view, `src/tui/*` for court menu, crown lock and progress |

Steps 2a and 2b run in parallel.

## Risks

- Step 1 rewrites the economy's data shape; the Python replay from phase 3 must be ported to the roster to verify it.
- Dispute expiry defaults change the economy under the strategy exit tests. If "reference never starves" breaks, that is a balance finding to bring back, not a test to loosen.
- The menu is TUI state with many keys; it must be testable without a renderer.

## Progress

| Step | Branch | Status |
| --- | --- | --- |
| 0 pacing spike | lead | done: promotion target 20 |
| 1 roster | `roster` | merged 4883b23 (559 tests); reviewer approved after one round of fixes; independent Python replay identical at 8 checkpoints for seeds 1 and 7 across reference, naive and none (24,000 ticks); planted bugs (grudge ignored, repeated names, farm-first starvation, idle not preferred) each fail their tests; TUI driven in tmux (cursor, f/w/m/i, rejection footer, save on quit). |
| 2a disputes | `disputes` | merged 732b328 (653 tests); reviewer approved after one round (grudge rule and content rewrite); replay with a scripted judge settling disputes also identical (3 seeds × 2 strategies); the Python replay including the desk is identical at 7 checkpoints for seeds 1, 7 and 42 across reference, naive and none (24,000 ticks, 17 disputes in the seed-1 reference run); reference still reaches 40 with no starvation; planted bugs (wrong grudged party, unclamped expiry, unaffordable ruling accepted, grudge shortened) each fail a test |
| 2b decree menu | `decree-menu` | merged c1c0cf0 (591 tests); reviewer approved after one round of fixes; driven in tmux: enacted a labor decree with a grain-seasons rule (the decree moved peasants to farming), repealed it, Escape closed the menu, q saved |
| 3 promotion | `promotion` | merged 375025b (695 tests); reviewer approved after one round (two-line footer, scrolling peasants panel, a test that could not fail); promotion tick matches the Python replay for seeds 1, 7 and 42 (10534, 10493, 10560); full TUI play-through at 120 columns from a save at tick 10,400: court ruling, grudge refusal, promotion notice, no re-announcement on reload |
