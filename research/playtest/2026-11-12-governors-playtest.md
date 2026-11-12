---
title: "Governors playtest feedback: what each item touches"
status: draft
tags: [playtest]
created: 2026-11-12
updated: 2026-11-12
---
# Governors playtest feedback: what each item touches

## Question

Garret playtested the phase 8 build (governors, favor, debt) and sent 18 items. For each one: what does the code do today, where would the change go, and which items share a foundation? Follows [[handoff/promotion/phase-8-done]].

The items, grouped by the foundation they need:

- **Tech tree** (1, 2, 14): many more upgrades, paid in wood, ore, grain and coin, each visible only after a threshold. The Crown panel, governors, the Court, decrees, forging and conjuring all become purchases. The Archive hides what you already own.
- **Illusion risk** (10, 12a, 13, 15, 16): auditors too often, forging grain starves you, interest too high, "forge missing", conjuring seems to do nothing.
- **Pacing and scaling** (8, 11, 12b): crown demands too frequent, missive rewards don't scale while grudges stay just as bad, governors die with no explanation.
- **Copy and content** (7, 9): more variety in court missives, clearer governor report text.
- **Village screen** (3, 4, 6, 17): name the village, show the current title instead of "promoted to steward on", rebalance panel widths, put "eaten" on the grain line.
- **Economy** (5): idle peasants eat less.

## Findings

### Tech tree: the unlock system can carry it, with four extensions

How unlocks work today:

- Ownership is `state.career.unlocks: Record<id, tick>` (`src/core/state.ts:16`), and `UnlockManager.enabled` checks it (`src/core/unlocks.ts:46`).
- An id gets there in one of three ways:
  - An Archive purchase (`UnlockManager.buy`, `unlocks.ts:92`).
  - A `play` rule with a single condition, latched each tick by `UnlockManager.run` (`unlocks.ts:64`).
  - Hard-coded grants. Promotion grants the Crown panel (`step.ts:30-40`). The first crown demand grants conjuring (`crown.ts:308-309`).

What is gated today:

| Thing | Gate today |
| --- | --- |
| Archive panel | `play`: coin above 0 |
| Crown panel and `deliver` | promotion, hard-coded |
| Conjure, back and forge | first crown demand, hard-coded |
| Palette, saved decrees, compound, chaining, crown correspondence, Exact books, True reports | Archive purchases, coin only (100 to 800) |
| Court, Decrees, Ledger, Peasants | always open; `needs: undefined` in `village-panels.ts:198-201` |
| Governor candidates | `promotedAt !== 0` (`governors.ts:148-153`), not an unlock |

What the tech tree needs on top of this:

1. **Costs in several resources.**
   - `ArchiveEntry.cost` is a single coin number. It is used in `unlocks.ts:16` and `:114-118`, in `view.ts:139-140`, and in `archiveLabel` in `village-panels.ts:217`.
   - It becomes `Partial<Record<Resource, number>>`.
   - Coin and grain go through `illusion.spend`, so conjured stock counts. Wood and ore are never conjured, so they spend real stock.
2. **Visibility thresholds that latch.**
   - The condition language can already express "wood above 200" (`decree.ts` `QUANTITIES`, `conditions.ts`).
   - Current stock can fall back, so visibility has to latch the way `play` does.
   - Possible additions: a `shown` condition per entry, and latching "seen" ids in career state.
   - A `requires` graph already exists and is checked for cycles in `archiveIssues`.
3. **Locking any panel.**
   - `lockedPanels()` (`unlocks.ts:51`) is hard-coded to the Archive and Crown panels, and `PanelId` is narrower than `FocusId`.
   - Each panel already declares `needs` on its static `keys` (commit 358a73b), and `Keymap.ownedPanels` filters focus by it.
   - So the fix is: derive `lockedPanels` from every panel's `needs`, and give Court and Decrees a `needs`.
4. **Effects that change numbers.**
   - Today `Game.tuning` is static. Each manager has a private `tuning` getter (commit 1dfc2c9), and economy has wrapper getters (`grainPerFarmer`, `grainPerPerson`).
   - Upgrades that change numbers belong in those getters. Each one would read `unlocks.enabled(...)` and apply a factor from the entry's data.
   - Watch for wood and ore yields: they are read inline in two places, `economy.ts:201/203` (`yieldPerWorker`, also used by governors) and `economy.ts:249-250` (`run`). Both must use one getter.
   - `priceOf` (`economy.ts:277`) is the single sell-price read, which makes it the natural home for conversion-rate upgrades.

Other findings for the tech tree:

- **Stockpile cap.** There is none today. `maxResourceValue` is 1e300 and only guards against overflow (`math.ts:25-53`).
  - A per-resource cap goes through `add()`, along with a view field and Ledger display.
  - Decide what happens to production that overflows the cap: lost, or sold automatically. Lost is simplest.
- **What wood and ore are for.** Nothing consumes them except selling and crown demands, which is the playtest complaint.
- **Saves.**
  - `SCHEMA_VERSION` is 14, and the next step is `UPGRADES[14]` in `src/save/save.ts`.
  - Steps 9 and 11 show how to grandfather an unlock that used to be free. Saves that already own the Court, Decrees, Crown or conjuring keep them.
- **Missive kinds.** These are drawn by weight at `desk.ts:404`. "More kinds of missives" as upgrades means filtering kinds by unlock at the draw.

### Illusion: conjuring works, but nothing tells you so and it only fools outsiders

Item 16, conjuring seems to do nothing:

- It is locked until promotion plus the first crown demand. Before that the core returns "you cannot conjure yet", and the command line shows `!conjure`.
- Once unlocked it works, but:
  - The command returns `{ok:true}` with no message.
  - It adds 25 conjured units, shown as "(25 conjured)" under the stock, and that stock fades by half each season (`fadePerTick` 0.00115).
  - Conjured stock is only used by `illusion.spend`: crown deliveries, Archive purchases, hiring and desk costs.
  - Peasants never eat it, decrees never see it, and audits don't count it.
- Root cause: the conjure path has no bug. The player gets no feedback, and the item only works if you then pay an outsider.

Items 10 and 12a, auditors come too often (`runAudit`, `illusion.ts:434-466`):

- An audit is due when the debt's value reaches half the ceiling (35% when favor is cold), or when the debt is 4 seasons old.
- Debt compounds while the ceiling stays flat. Deepening multiplies debt by 1.5 and resets only the age clock, so the value condition fires again the next tick.
- Example: forging one 625-grain demand at population 20 brings the first auditors in about 2.6 seasons. After one deepen they come every season, and every half season once favor goes cold.

Item 10, forged grain starves you:

- Grain debt is repaid only from real grain, by `back` or by seizure when an audit fails.
- The crown's one-season grain reserve doesn't protect against either.
- A 625-grain forge grows to about 880 by the first audit. A population of 20 eats about 120 grain a season.

Item 13, interest:

- Interest is `debt *= 1 + 0.00016` every tick, about 10% a season compounded, or 47% a year.
- Combined with the 1.5 multiplier for deepening, that is the "growing cost".
- Simple interest at X% per season needs the principal stored per resource, or the per-tick rate turned off and applied at season ends.

Item 15, forge missing:

- `forge` already forges only what is still owed: `min(crown.owed, room/price)` (`illusion.ts:319`).
- "Forge missing" is `deliver` followed by `forge` in one command. Two catches:
  - Deliver keeps the one-season grain reserve.
  - Deliver spends conjured stock first.
- The new command sits next to `forge` in `commands.ts`, `illusion.ts:306`, the command line verbs and the Crown panel keys.

### Pacing and scaling

Item 11, crown demands (`crown.ts`, `data/crown.json`):

- The gap between demands is already random, 1200 to 2400 ticks (2 to 4 seasons).
- The 1800-tick deadline is fixed, and the gap starts only when a demand closes. A full cycle is 5 to 7 minutes.
- The first demand comes at a fixed 600 ticks after promotion.
- Amounts grow by 30% of the base for each demand met.
- The lever is a wider gap, with the deadline and first demand also drawn with `drawDelay`.

Item 12b, governor deaths (`governors.ts:~330-340`):

- Each governor has a 2% chance of dying each season, and a term is 16 to 32 seasons. About 38% die before they retire.
- The notice is "{name} has died, and their village is gone with them." It gives no cause.
- No player lever affects it, and nothing shows the remaining term.

Item 8, missive scaling (`desk.ts`, `data/desk.json`):

- Every amount is a fixed literal, for example the smith's +20 coin or the cartwright's -30 grain.
- A grudge idles one peasant for one season (`grudgeUntil`, `delegates.ts:111-138`).
- Nothing scales with population.
- Grudges only ever hit peasants, so their cost is fixed at one peasant-season. That shrinks relative to the realm, but feels the same because rewards don't grow either.

### Copy and content

Item 9, governor text (`copy.ts:246-249`, `roster.ts:20-50`):

- Before True reports, a governor's row shows "reports {rate}".
- After True reports, it shows "makes {real}" and "reports {gap} too much".
- `{rate}` is a bare per-second number with no resource and no unit.

Item 7, court variety:

- The Court has 14 templates: 6 disputes, 3 merchants, 2 travellers and 3 candidates.
- The decree grammar is already expressive: 4 petitions, 15 quantities, and the season, chose and boolean conditions.
- "Court decrees" most likely means missive content; confirm with Garret.

### Village screen

- **Widths (item 6):** the top row is Ledger, Peasants and Archive with flex weights 1, 1 and 2 (`panels.ts:231-236`). Changing the weights is the fix, and `panels.test.ts` may assert widths.
- **Title (item 4):**
  - The Ledger shows "Promotion N / target" before promotion and "Promoted to steward on <time>" after (`village-panels.ts:505-522`, `copy.ledger.promotedOn`).
  - There is no title ladder; the only ranks are peasant and steward.
- **Village name (item 3):**
  - There is no name in state.
  - The new-game flow is `foundNewVillage` (`app.ts:144-154`), from a list menu.
  - The command line's editing and cursor (`command-line.ts`, `command-cursor.ts`) could be reused for a free-text prompt.
  - A name needs a state field and a schema bump.
- **Eaten line (item 17):** "(N/s eaten)" is a separate indented line under grain in `resourceLines` (`village-panels.ts:453-488`). Append it to the grain row instead.
- **Archive owned entries (item 14):**
  - Both `archiveScreen` and `unfocusedLines` map every entry, and owned ones show "owned".
  - Filter `!owned` at the panel, and show an empty-state line.

### Economy

Item 5, idle peasants eat less:

- Upkeep is `population * grainPerPerson` (`economy.ts:209-211`). `grainUpkeepPerSeason` (`:167-170`) and the view's eaten rate use the same formula.
- `Job.IDLE` exists (`realm.ts:5-11`), and `realm.labor.idle` is already counted.
- Add an `idleGrainFactor` to economy tuning and apply it to idle peasants' share of upkeep.
- Peasants idle from a grudge would count too.

## Sources

- Four parallel code explorations on 2026-11-12, covering unlocks and the Archive, illusion, crown/governors/desk, and the village screen. Each reproduced numbers with `bun -e` against the core `Game` where noted.
- [[handoff/promotion/phase-8-done]], [[plan/promotion/phase-8]]

## Open questions

- Does "court decrees" (item 7) mean missive content or decree grammar?
- What is free at the start of the tech tree, and which upgrades does the first tier hold?
- Should conjured grain stay something that only fools outsiders, or should peasants eat it?
- Does buying the Crown panel start crown demands, or does promotion still start them?
- Should audits keep a reserve of real grain when they seize stock?
