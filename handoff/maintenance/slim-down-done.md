---
title: "Slim-down merged: schema module, test suite cut by 38%"
status: closed
tags: [maintenance]
branch: main
created: 2026-11-01
updated: 2026-11-06
---
# Slim-down merged: schema module, test suite cut by 38%

## Context

Continues `plan/maintenance/slim-down.md` (now completed). Goal: make each feature cheaper for implementers by shrinking the test suite and replacing five hand-written parsers.

## Done

Seven commits on `main`, 1221fe9..c9f40f7, nothing pushed:

- `src/core/schema.ts`: one declarative schema module (object, keyedBy, record, array, integer, number, string, literal, variant, lazy, tuple, refine, custom). Tuning, decrees, conditions, commands, command logs, strategies and saved-state validation all use it.
- Save migrations for versions 6 and 7 removed (user decision); older saves take the refusal path.
- Tests rewritten as tables, help and panel text no longer pinned word for word, per-field rejection tests deleted, unused `decreeLine` removed.
- `CLAUDE.md` has a "Tests" section (6ad69bc).

Numbers on c9f40f7: 823 tests (954 before), 6,709 test lines (10,750 before), 6,093 source lines (6,400 before), 98.34% line coverage (98.3% before). The ~5,000-line target was not reached; reviewers found no further tests to cut without losing a guard.

Verification: every branch was reviewed with planted bugs; reviewers found and the implementers restored about ten lost guards that coverage did not show. The lead independently checked that parsed tuning is byte-identical to the old parser's, that a 20,000-tick save written by the old code loads with the same state hash, that simulator hashes match for all four strategies, and planted one bug per branch before merging.

## In progress

- Skill edits (`.claude/skills/{implementer,reviewer,project-lead}/SKILL.md`) are uncommitted on `main`, layered on the user's own uncommitted edits: test budget in briefs, quote plan sections instead of whole plans, reviewer compares test lines to source lines and plant-checks deleted tests, reword the squash commit after `wt merge`. The user should review and commit them.

## Next steps

- Fixed in 4ecc686: loading a save now repeals decrees whose policies the current tuning no longer offers (and decrees testing for or depending on them), with a startup notice.
- Optional: the simulator's per-tick validation is about 1.4 times slower than before (schema `check` builds fresh objects that validation throws away). A check-only mode in `schema.ts` would recover it if sim speed matters.
- CI has not run on any of this; nothing is pushed.

## Gotchas

- `wt merge` squashes a multi-commit branch into "Squash commits from …"; reword it on `main` with `git commit --amend`.
- Line coverage missed every lost guard in this work. Plant the bug when deleting a test.
- A `refine` runs only when its subtree has no shape problems, so `validateState` lists every shape problem but may hide cross-field problems behind them.
- The `lazy` depth guard caps condition nesting at 64; a tuning `maxConditionDepth` above 64 would report the guard's message instead.
- Some test tables use `// biome-ignore format: one row per case`; this is accepted practice now.
