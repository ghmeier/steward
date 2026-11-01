---
title: "Steward: Phase 3 implementation plan (decree engine, headless)"
status: completed
tags: [phase-3, decrees]
created: 2026-10-28
updated: 2026-11-01
---
# Steward: Phase 3 implementation plan (decree engine, headless)

Phase 3 adds a small village economy and the decree engine that runs it, so that a set of decrees can hold the economy steady in the headless runner with no player input. Builds on [[plan/engine/phase-1]] and [[plan/tui/phase-2]].

## What the development plan says

Source: the claude.ai "Steward: Development Plan" doc (build order item 3, and the "Decree engine" and "Dead time" paragraphs).

- **Decree engine, headless first.** Simple policies, then conditions, then chaining with cycle detection. Exit: a set of decrees holds a stable economy in the runner with no player input.
- **Decree engine.** Decrees are data, not code. Each decree is an expression tree of policy, conditions and outputs that the engine evaluates every tick. Chained decrees are ordered by their dependencies, and cycles are rejected when a decree is saved. Upgrades widen what the tree may express rather than scaling numbers.
- **Dead time.** From phase 3 onward, run a few scripted player strategies in the headless runner and measure how often each has to act.
- **Decree language scope.** Cap what the tree may express so it does not grow into a programming language.

From the game design doc: each decree handles a category of petitions, and each option shifts different outcomes ("a grain decree might sell surplus, stockpile for winter, or feed population growth"); conditions look like "stockpile unless reserves exceed two seasons"; chaining means the output of one decree feeds another. Core production numbers never use the RNG.

## Scope and exit criteria

In scope: a four-resource village economy with population, labor and seasons; a manual `assignWorker` command and keys; the decree data model, parser and dependency ordering; `enactDecree` and `repealDecree`; decree evaluation every tick; the runner's `--strategy` and `--record` flags with dead-time metrics; four reference strategies.

Out of scope: decree entry in the TUI (phase 4 adds a menu, phase 5 the type-ahead), saved decrees in the career layer and unlock tiers (phase 5), the desk and crown (phase 6), balance.

Exit criteria:

1. In a ten-year run (24,000 ticks) with no player input after setup, the reference strategy loses no peasants and ends with more peasants than it started with.
2. The same run with no decrees, and with the naive "always sell" decrees, loses peasants.
3. Enacting a decree that would create a dependency cycle is rejected with the cycle in the reason, and the active decrees are unchanged.
4. A strategy run recorded with `--record` and replayed with `--commands` reproduces the same state hash.
5. The runner reports how often each strategy acts, and `bun run check` passes.

## Lead decisions (2026-10-28, made while Garret was away; confirm on return)

- **The toy system is retired.** Its random grain would fight the economy's grain, and the decree tests need numbers that only the economy moves. `setToyRate`, `adjustToyRate`, the toy tuning and the `+`/`-` keys go. `RNG_STREAMS` becomes empty until phase 6 adds desk events; the RNG module and its tests stay.
- **A minimal economy is built in this phase**, because the exit criterion needs something to stabilize. Its shape is below; every number is tuning and will move during balancing. The lead checked the numbers with an independent Python model (spike below) before briefing.
- **Manual labor keys replace the toy keys.** `f`, `w` and `m` assign one idle peasant to the farm, forest or mine through a new `assignWorker` command, so keys still issue commands and the rejection path ("no idle peasants") still shows in the footer. This is also the manual path a player uses before decrees exist in the TUI.
- **Two petitions in phase 3: `harvest` and `labor`.** At most one active decree per petition. More petitions arrive with later systems.
- **A decree is rules plus a fallback**: an ordered list of `{ when, policy }` rules and an `otherwise` policy. The first rule whose condition holds wins. A simple policy is a decree with no rules.
- **Chaining is a `chose` condition**: a decree can test which policy another decree chose this tick. That reference is the dependency edge. Decrees run in dependency order, ties broken by id. Self-reference counts as a cycle.
- **Expressiveness is capped by tuning** (`maxRules`, `maxConditionNodes`, `maxConditionDepth`). Phase 5's unlock tiers will lower or raise these caps per tier.
- **Enact checks happen at apply time**, so a bad decree from a key, a strategy or a log is a rejected command, never a crash. `parseCommand` only checks that `decree` is an object.
- **Repealing a decree that another active decree references is rejected**, rather than cascading.
- **Schema version** goes to 2 with the economy and 3 with decrees. Older saves are refused, as the save rules already say.
- **Strategies live in `strategies/` at the repo root**, not in `data/`, because they are test inputs for the runner, not game content, and must not change the content hash.
- **Strategy reactions are edge-triggered**: a reaction fires when its condition becomes true, so a held condition does not fire every tick. Strategy conditions may not use `chose`.

## Spike (lead, done)

`/tmp/steward-spike/econ.py` modelled the economy below with the tuning values below for 24,000 ticks:

| Strategy | Peasants lost | Population after 10 years | Reaction commands |
| --- | --- | --- | --- |
| No decrees | 10 (all, in the first season) | 0 | 0 |
| Naive: always sell, farming allocation | 10 (first winter) | 0 | 0 |
| Reference: chained granary and workforce decrees | 0 | 40 (the cap, reached in year 9) | 0 |
| Seasonal: naive plus reactions on reserves | 0 | 10 | 21 |

The thresholds separate cleanly, so exit criteria 1 and 2 can be asserted. Growth to the cap takes nine game years (36 minutes of play); that is a balance question for later.

## Economy

Shared constants live in `src/core/realm.ts` (scaffolded by the lead):

```ts
export const RESOURCES = ["coin", "grain", "ore", "wood"] as const;
export const JOBS = ["farm", "forest", "mine"] as const;
export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;
```

State, `posting.economy`: `{ population, labor: Record<Job, number>, hunger, growth, starved }`. `population`, each `labor` count and `starved` are non-negative integers; the labor counts sum to at most `population`, and the rest are idle. `hunger` and `growth` are non-negative finite numbers. `posting.resources` always holds all four resources.

Season of tick `t` (t ≥ 1) is `SEASONS[floor((t - 1) / ticksPerSeason) % 4]`; tick 0 counts as spring.

Each step, after commands are applied, `runEconomy` does, in order:

1. **Produce.** grain += farm × grainPerFarmer × seasonYield[season]; wood += forest × woodPerWorker; ore += mine × orePerWorker. All through `add`.
2. **Eat.** upkeep = population × grainPerPerson. If grain ≥ upkeep: grain −= upkeep and hunger = 0. Otherwise hunger += upkeep − grain, grain goes to 0, and while hunger ≥ starvationHunger and population > 0: one peasant dies (an idle one if any, else from mine, then forest, then farm), hunger −= starvationHunger, starved += 1.
3. **Report flows.** It returns `{ grainSurplus: max(0, produced grain − upkeep) }` for the decree engine.

Policy effects, called by the decree engine:

- `sellGrain(amount)`: grain −= amount, coin += amount × grainPrice.
- `feedGrain(amount)`: does nothing at `maxPopulation`. Otherwise grain −= amount and growth += amount; then while growth ≥ grainPerPeasant and population < maxPopulation, one idle peasant is born and growth −= grainPerPeasant.
- `laborTargets(population, shares)`: largest-remainder apportionment. Each job gets floor(population × share); the leftover peasants go one each to the jobs with the largest fractional remainder, ties to the earlier job in `JOBS`. The targets sum to `population`.
- `moveLaborToward(target, moves)`: up to `moves` times: pick the job with the largest shortfall (target − labor > 0, ties to the earlier job); stop if none. Take the peasant from idle if any are idle, else from the job with the largest excess (labor − target > 0, ties to the earlier job); stop if none.

`grainSeasons` = grain / (population × grainPerPerson × ticksPerSeason). When that divisor is 0 it is 0 if grain is 0, else `maxResourceValue`.

Tuning, `tuning.economy` (the toy section is removed):

```json
"economy": {
	"ticksPerSeason": 600,
	"seasonYield": { "autumn": 1, "spring": 1, "summer": 1.5, "winter": 0 },
	"grainPerFarmer": 0.025,
	"woodPerWorker": 0.02,
	"orePerWorker": 0.01,
	"grainPerPerson": 0.01,
	"starvationHunger": 2,
	"grainPrice": 0.5,
	"grainPerPeasant": 30,
	"maxPopulation": 40,
	"laborMovesPerTick": 1,
	"initialPopulation": 10,
	"initialResources": { "coin": 0, "grain": 60, "ore": 0, "wood": 0 },
	"laborAllocations": {
		"balanced": { "farm": 0.5, "forest": 0.3, "mine": 0.2 },
		"farming": { "farm": 0.7, "forest": 0.2, "mine": 0.1 }
	}
}
```

A new game starts with `initialPopulation` idle peasants, zero hunger, growth and starved, and `initialResources`.

## Decree language

`src/core/decree.ts`:

```ts
export const PETITIONS = ["harvest", "labor"] as const;
export type Petition = (typeof PETITIONS)[number];
export const QUANTITIES = ["coin", "grain", "grainSeasons", "idle", "ore", "population", "wood"] as const;
export type Quantity = (typeof QUANTITIES)[number];
export type Condition =
	| { kind: "compare"; quantity: Quantity; comparison: "above" | "below"; value: number }
	| { kind: "season"; season: Season }
	| { kind: "chose"; decree: string; policy: string }
	| { kind: "all"; conditions: Condition[] }
	| { kind: "any"; conditions: Condition[] }
	| { kind: "not"; condition: Condition };
export type DecreeRule = { when: Condition; policy: string };
export type Decree = { id: string; petition: Petition; rules: DecreeRule[]; otherwise: string };
export type DecreeLimits = { maxRules: number; maxConditionNodes: number; maxConditionDepth: number };
```

- `above` is strictly greater, `below` strictly less.
- Harvest policies are `feed`, `sell` and `stockpile` (fixed in code). Labor policies are the keys of `tuning.economy.laborAllocations`.
- `tuning.decrees` = `{ "maxRules": 4, "maxConditionNodes": 8, "maxConditionDepth": 3 }`.

## Task order

| Step | Branch | Depends on | Files owned |
| --- | --- | --- | --- |
| 1 economy | `economy` | realm scaffold | `src/core/{economy,state,step,commands,tuning,validate,view}.ts`, delete `src/core/toy.ts`; `data/tuning.json`; `src/tui/{keys,panels}.ts`; `src/runner/sim.ts`; tests and fixtures they break |
| 2 decree model | `decree-model` | realm scaffold | `src/core/decree.ts`, `test/decree.test.ts` only |
| 3 decree engine | `decree-engine` | 1 and 2 merged | `src/core/decree-engine.ts` (new), commands, state, step, tuning, validate, golden |
| 4 strategies | `strategies` | 3 merged | `src/runner/{sim,strategy}.ts`, `strategies/*.json`, runner tests |

Steps 1 and 2 run in parallel.

## Risks

- Step 1 touches many files at once. The tests it breaks are mostly toy fixtures; the brief lists them.
- Floating-point growth is deterministic but the independent Python model must apply operations in the same order to match exactly; the lead compares values, not hashes.
- Dead time: the reference strategy never acts after setup, which satisfies the exit criterion but says the economy is too easy. Shocks in phase 6 are what make decrees need retuning.

## Dead-time results (seed 1, 24,000 ticks, `bun run sim --strategy`)

| Strategy | Peasants lost | Population after 10 years | Reaction commands | Longest stretch with no action |
| --- | --- | --- | --- | --- |
| `none` | 10 | 0 | 0 | 24,000 ticks |
| `naive` | 10 | 0 | 0 | 24,000 ticks |
| `reference` | 0 | 40 | 0 | 24,000 ticks |
| `seasonal` | 0 | 10 | 21 | 1,409 ticks (about 2.3 minutes) |

All five exit criteria hold. The reference set never needs the player again, which is the dead-time risk in plain form: without shocks, a good decree set leaves nothing to do. Phase 6's desk and crown quotas are what should force retuning.

## Progress

| Step | Branch | Status |
| --- | --- | --- |
| 0 balance spike | lead | done: thresholds separate (table above) |
| 0 realm scaffold | lead (main) | merged 0133077 |
| 1 economy | `economy` | merged e20359f; an independent Python replay matched `bun run sim` bit for bit on the golden log (10,000 steps) and on two starvation runs; planting farm-first starvation fails the order test; TUI checked by hand in tmux (keys, rejection footer, rates, save on quit) |
| 2 decree model | `decree-model` | merged 9fb24ca; `orderDecrees` matched an independent smallest-first ordering on 5,000 random graphs (about a third with cycles, every reported cycle genuine); removing the cycle trim fails the cycle test |
| 3 decree engine | `decree-engine` | merged 59e5d58; an independent Python replay matched `bun run sim` bit for bit at four checkpoints of the golden log and on 24,000-tick reference and naive runs; planting id-order evaluation fails the chaining test, and skipping the cycle check fails the cycle test |
| 4 strategies | `strategies` | merged d7ecfd9; an independent Python player produced a command log identical to `--record` for `seasonal` (23 entries) and replaying it gives the same hash (cd86a994); making reactions fire every tick fails the edge-trigger test |
