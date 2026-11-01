---
title: "Refuse hand assignment while a labor decree is in force"
status: archived
tags: [mechanics]
created: 2026-11-01
updated: 2026-11-01
---
# Refuse hand assignment while a labor decree is in force

While a labor decree is in force, `assignPeasant` changes a job and the decree moves the peasant back on the next tick, so assigning looks broken. Found in the phase 5 exit check ([[handoff/unlocks/phase-5-done]]).

## Decision (Garret, 2026-11-01)

Refuse with a reason. While any decree for the `labor` petition is in force, `assignPeasant` is rejected with state unchanged, and the reason names the decree and says to repeal it to assign by hand. This covers assigning to idle too, since the decree would move an idle peasant as well. Decrees stay the single source of labor; no new state, no schema change.

## Progress

| Step | Branch | Status |
| --- | --- | --- |
| 1 refuse assign | `assign-refusal` | dropped 2026-11-01: Garret decided the current behavior is fine |
