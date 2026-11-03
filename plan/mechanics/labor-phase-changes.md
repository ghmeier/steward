---
title: "Labor decrees act on phase changes, so hand assignments stick"
status: active
tags: [mechanics]
created: 2026-11-03
updated: 2026-11-03
last_pr: 6
next_step: Garret reviews PR #6; on merge flip to completed
---
# Labor decrees act on phase changes, so hand assignments stick

From Garret's playtest of PR #4, 2026-11-03. Supersedes the archived [[plan/mechanics/assign-under-labor-decree]].

## Problem

`DecreeEngine.run` calls `economy.moveLaborToward(target)` on every tick while a labor decree is in force. A hand `assignPeasant` is accepted, but the decree moves that peasant back within a tick or two, so a one-off assignment is impossible.

## Rule

- A labor decree **settles** the village toward its split only after its chosen policy changes. Enacting the decree counts as a change, and so does a rule switching from `farm` to `mine` when winter starts. It keeps moving `laborMovesPerTick` peasants a tick until the split is reached, then stops.
- A hand assignment during settling ends that settling. Garret's ask is that hand assignments stick between phase changes.
- **Newborns:** a peasant born while a labor decree is in force is placed straight onto the job furthest below the current split's target, or left idle if no job is short. This does not restart settling or move anyone else. (Garret, 2026-11-03.)
- With no labor decree, nothing changes.

## Implementation

- State: `PostingState` gains `labor: { policy: string | null; settling: boolean }`. `policy` is the labor policy chosen last tick, and null when no labor decree is in force. Bump `SCHEMA_VERSION` to 9. A version 8 save migrates to `{ policy: null, settling: false }`, so the first tick reads as a change and settles, which matches today's behavior. Follow the existing migration pattern in `src/core/serialize.ts` and `validate.ts`.
- `DecreeEngine.run`, labor branch: compare the chosen policy with `labor.policy`. On a change, set `settling = true`. While settling, call `moveLaborToward`, and clear `settling` once `laborTargets` is met. On repeal, set `policy` back to null.
- `assignPeasant` in `commands.ts`: an accepted assignment clears `settling`.
- Placing newborns: where `delegates.create()` runs during growth in `economy.ts`, place the new peasant using the current labor target when a labor decree is in force. Reuse `laborTargets` and `jobCounts`. Keep the placement rule in the economy or decree engine, not in delegates.
- Help: "A labor decree overrides the jobs you assign by hand." in `help-menu.ts` becomes a short description of the new rule.

## Verification

- Tests, each a small invariant, pairing positive and negative cases:
  - a hand assignment sticks while the policy is unchanged, and is overridden on the next phase change;
  - an assignment during settling ends settling;
  - a newborn is placed by the decree, and leaves hand-placed peasants alone;
  - enacting a decree settles, and repealing it then re-enacting settles again;
  - a version 8 save migrates and settles on its first tick.
- The golden run will change, because `test/fixtures/command-log.json` enacts a labor decree and assigns peasants by hand afterwards. Re-record it with `bun run golden:update` only after confirming that the diff is explained by this rule. Explain the diff in the PR.
- Run `bun run sim` with the reference strategy before and after, and report income and population at the same tick. A large drop means newborn placement or settling is wrong.

## Progress

| PR | Branch | Status |
| --- | --- | --- |
| 1 | `labor-phase-changes` | PR #6 open (f33c408), awaiting review |

## Notes and decisions

- 2026-11-03: Garret approved the rule, including that a hand assignment during settling ends settling.
- 2026-11-03: Implemented as `LaborSettling` in src/core/labor.ts (`game.labor`). The policy is stored as a string, with an empty string meaning no labor decree, because state validation and `canonicalStringify` reject null. The golden diverges first at tick 3000, where a hand assignment now sticks; only its hash changed. The reference and seasonal simulator runs match main. The naive run ends with more peasants and more famine deaths, because newborns now go straight to a job.
- 2026-11-03: Correction: the codebase had no save migration; every version bump refused older saves. Garret chose to upgrade version 8 saves to 9 on load with one small upgrade step; older versions are still refused.
