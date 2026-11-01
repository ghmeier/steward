---
title: "Playtest fixes merged: resource decrees and gentler famine"
status: picked-up
tags: [mechanics]
created: 2026-10-29
updated: 2026-11-01
---
# Playtest fixes merged: resource decrees and gentler famine

## Context

Continues [[plan/mechanics/resource-decrees]] and [[plan/mechanics/gentler-famine]], both completed. On `main`: df735cb (wood and ore decrees) and 6351ace (gentler famine). The pre-merge hook ran `bun run check` with 790 passing.

## Done

- **Resource decrees:** petitions are harvest (grain), wood, ore and labor. Feed is grain-only. A bare "above" threshold on the decree's own resource sells or feeds everything above it; any other rule acts on that tick's production. Wood sells for 0.5 coin and ore for 1.
- **Gentler famine:** a famine kills at most half the population it started with, one every season / cap ticks, and ends when everyone eats. Save schema 7; version 6 saves migrate on load.

## Verification

- A probe ran Garret's decree (feed above 75 grain, sell above 50 wood, sell above 20 ore) for 30,000 ticks: wood never exceeded 50 and ore never exceeded 20.
- A probe loaded Garret's real save (copied) and migrated it, and a 37-peasant famine killed exactly 18 peasants, on the expected ticks.
- Planted bugs (negative threshold, wrong famine cap) failed the tests.

## Not verified

- CI has never run (no remote).
- The main checkout had uncommitted changes nobody in this session made: edits to `.claude/skills/implementer/SKILL.md` and `.claude/skills/project-lead/SKILL.md`, and deleted `test/core-boundary.test.ts` and `test/rng.test.ts`. Left untouched; ask Garret.

## Next steps

1. Garret: playtest. A fixed grain threshold such as "feed above 75 grain" lets a big village boom then starve in winter; rules on grain seasons hold up better.
2. Still open: the trade petition, dispute costs, and phase 5's type-ahead decree builder.

## Gotchas

- The grain petition is still called `harvest` internally, to keep saves and strategies valid.
- Probe scripts are in `~/.cache/steward-probes/`; copy one to the repo root to run it.
