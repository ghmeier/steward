---
title: Phase 4 (village phase) merged; the game is playable to promotion
status: picked-up
tags: [phase-4]
branch: main
created: 2026-10-29
updated: 2026-11-01
---

# Phase 4 (village phase) merged; the game is playable to promotion

## Context

Continues [[plan/village/phase-4]] (now completed) and picks up [[handoff/decrees/phase-3-done]]. All phase 4 work is on `main`:

| Commit  | Step                                         |
| ------- | -------------------------------------------- |
| 4883b23 | Named peasants                               |
| c1c0cf0 | Decree menu                                  |
| 732b328 | Disputes                                     |
| 375025b | Promotion, locked crown panel and court menu |

`bun run check` passes on macOS arm64 with 695 tests.

## Done

- Peasants are named delegate records, and the roster is the only source of population and labor. The player selects a peasant with j/k and assigns them with f, w, m or i.
- Disputes between two named peasants arrive on a three-slot desk about every 1.5 to 3 minutes. The player settles them from the court menu (c). When the desk overflows, the oldest dispute resolves on a small default cost. A ruling can grudge one party for a season. A grudged peasant produces nothing and refuses to be given a job.
- The decree menu (d) enacts a decree for either petition, with rules of one condition each, and repeals decrees.
- Promotion fires once at 20 peasants and is kept even if the population falls. The reference strategy is promoted after about 17.5 minutes. The crown panel reads "Locked."
- The footer has two lines, so messages are never hidden behind the key hints. The peasants panel scrolls to keep the selected peasant visible.
- Verification:
  - A Python model written from the plan matched the engine bit for bit, desk included. It covered three seeds and three strategies, both with and without a scripted judge that settles disputes, over 24,000 ticks.
  - Planted bugs were each caught by a test. They covered grudges, names, starvation order, labor moves, grudge party, expiry clamping, affordability and grudge extension.
  - Every step was driven by hand in tmux. The final run went from a save at tick 10,400 to promotion at 120 columns.

## Not verified

- CI has still never run (no remote). Linux is untested.
- Nobody has played a fresh game from tick 0 to promotion by hand. The hand checks used a save prepared by the reference strategy, so the pacing for a learning player is a guess.
- The panel height for scrolling comes from the terminal height and the grid layout, not a measured panel. It can be one row short when the flex split rounds, and it misbehaves in terminals under about 10 rows.

## Next steps

1. Garret: confirm the phase 4 lead decisions in the plan. These are the ones you didn't pick yourself:
   - The promotion target is 20.
   - A grudged peasant refuses to be given a job. This was added after the reviewer found that grudging an idle peasant cost nothing.
   - Labor decrees pause rather than move another peasant when every worker in the job with the most excess is grudged.
   - Village content lives in `data/village.json`.
   - Saves from earlier builds are refused (schema version 6).
     ANSWER: I approve this
2. Garret: the growth-store question from phase 3 is still open. Grain fed toward growth while the village is at the population cap is kept, so births follow at once after a famine.
   ANSWER: sounds good
3. Play one fresh game to promotion by hand and judge whether disputes and decrees leave enough to do. The dead-time risk from phase 3 still stands until the crown's quotas arrive in phase 6.
   ANSWER: this is fine. I'm getting feedback.
4. Phase 5: the type-ahead decree builder replaces the decree menu. Build it on `src/tui/menu.ts` or alongside it. `LOCKED_PANELS` in `src/core/view.ts` moves into the unlock registry.
   ANSWER: Ok sounds good
5. Carried over: create the GitHub remote and run CI on macOS and Ubuntu.
   ANSWER: No need to worry about this.

## Playtest feedback (Garret, 2026-10-29)

- **Help screen:** he couldn't tell how decrees, coin or growth work. Merged as 67d3402: `?` opens eight topics, with every number computed from tuning and the dispute data.
- **Disputes are dull:** coin is too scarce, so he always picks the grain or grudge ruling. Proposed: a trade petition that sells wood and ore, and dispute costs in wood and ore. Waiting for his answer.
- **His village starved without any notice:** the harvest decree fed every grain above 50, which stops scaling past about 8 peasants in winter. Decided: failing is fine as long as he can restart. Merged as 98fce63: starved peasants are named in the footer, an empty village says so, and `n` founds a new village (with a confirmation, at any time, saving at once). There is no automatic recovery. The key hint "select peasant" became "select" so the hints line fits 120 columns.

## Gotchas

- `wt merge` squashes a branch into one commit with the message "Squash commits from <branch>". After every merge in this phase, the lead amended `main` back to the implementer's message. Do the same, or configure worktrunk to keep messages.
- The menu machinery lives in `src/tui/menu.ts`: a stack of screens rebuilt from the view on every key. The decree and court menus are `ScreenBuilder`s. The decree menu's add-rule walks pop a fixed number of screens (decree-menu.ts:162 and :179), so a new step in either walk must update that count.
- `moveLaborToward` takes `tick`, because grudges decide who can move. Starvation still kills grudged peasants in the usual order.
- `DeskOptionView.resources` keys are sorted. The court menu prints them in object order.
- The independent replay is at `/tmp/steward-phase4/roster_replay.py`, with the matching engine dump `dump.ts` and the near-promotion save builder `presave.ts`. These are in `/tmp`, so copy them before a reboot if phase 5 changes the core.
- Plant bugs in a copy of a worktree, never in the worktree itself, because reviewers run tests at the same time.
