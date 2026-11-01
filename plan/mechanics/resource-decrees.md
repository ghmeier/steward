---
title: "Decrees per resource: sell wood and ore, feed only grain"
status: completed
tags: [mechanics]
created: 2026-10-29
updated: 2026-11-01
---
# Decrees per resource: sell wood and ore, feed only grain

## Goal

Garret, playtesting (2026-10-29): a decree like "feed above 75 grain, sell above 50 wood, sell above 20 ore, otherwise stockpile" doesn't work, and "feed" should only be allowed for grain.

## Findings

The decree did what the engine says, not what the player meant. A harvest decree picks one policy per tick for that tick's grain surplus, and conditions only choose which policy. So "sell when wood above 50" sold grain whenever wood was above 50, and wood and ore could never be sold at all (help says "Neither can be sold"). Garret's save at tick 11,115 had 144.8 ore piled up and no harvest decree.

## Design (Garret chose both)

1. **One decree per resource.** Petitions are `harvest` (grain), `wood`, `ore` and `labor`. Grain's policies are `feed`, `sell` and `stockpile`; wood's and ore's are `sell` and `stockpile`. Wood and ore get a coin price.
2. **A threshold sells everything above it.** When the matched rule's condition is a plain `compare` with `above` on the petition's own resource (`grain` for harvest, `wood`, `ore`), the policy acts on the whole stock above that value, so "sell when wood above 50" brings wood back to 50 at once. Any other matched rule, and `otherwise`, act on this tick's new production only, as harvest does today (grain: the surplus after upkeep).

## Lead decisions

- The grain petition keeps the id `harvest`, so saves, strategies, command logs and the golden fixture stay valid with no schema bump. The TUI labels it as grain.
- The threshold rule applies only to a bare `compare` on the petition's own resource. `grainSeasons above 2`, compound conditions and season rules act on new production. This keeps every existing strategy and the golden replay unchanged (none use a `grain` compare).
- Prices: `woodPrice` 0.5 and `orePrice` 1. A forester then earns 0.01 coin a tick and a miner 0.01, a little under a farmer selling grain (0.0125 before upkeep).

## Progress

| Step | Branch | Status |
| --- | --- | --- |
| Resource decrees | resource-decrees | merged as df735cb |
