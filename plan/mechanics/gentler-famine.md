---
title: "Gentler famine: half the village at most, spread over a season"
status: completed
tags: [mechanics]
created: 2026-10-29
updated: 2026-11-01
---
# Gentler famine: half the village at most, spread over a season

## Goal

Garret, playtesting (2026-10-29): "starving is hella brutal. One peasant dying every second is rough." At most half the settlers should die, at a slower pace.

## Today

`runEconomy` adds unmet upkeep to `economy.hunger`, and every `starvationHunger` (2) grain of it kills one peasant. A 37-peasant village with empty stores eats 0.37 grain a tick, so it loses one peasant every 5 to 6 ticks (about two a second) and can die out entirely.

## Design (Garret chose)

- **A famine** starts on the first tick upkeep is not fully met, and ends on the first tick it is. While it lasts the village eats whatever grain is left, as today.
- **Cap:** a famine kills at most `floor(P / 2)` peasants, where P is the population when it started. One peasant never starves; three lose at most one.
- **Pace:** "divide half your peasants by the number of ticks". The cap's deaths are spread evenly across one season: after the famine has lasted `t` ticks, `floor(t * cap / ticksPerSeason)` deaths are due, never more than the cap. So a famine that lasts a full season kills exactly half the village, and the first death comes one interval in, not on the first tick.
- Victim order is unchanged (idle first, then mine, forest, farm). The starved count and the footer notice keep working.

## Lead decisions

- The window is one season (`ticksPerSeason`), since Garret said "the number of ticks" and a famine is a seasonal event. For 37 peasants that is one death every 600 / 18 = 33.3 ticks, about every 3.3 seconds.
- `hunger` and `starvationHunger` go away. The state gets the famine's starting population, its length in ticks, and its deaths so far. This bumps the save schema from 6 to 7, and `parseSave` migrates a version 6 save forward so Garret's playtest save survives.
- The golden hash and strategy pacing numbers may move because starvation now differs. They are regenerated only with an explanation.

## Progress

| Step | Branch | Status |
| --- | --- | --- |
| Gentler famine | gentler-famine | merged as 6351ace |
