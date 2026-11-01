---
title: Phase 1 built locally; needs a remote and CI run
status: picked-up
tags: [phase-1]
branch: main
created: 2026-10-28
updated: 2026-11-01
---
# Phase 1 built locally; needs a remote and CI run

Continues [[plan/engine/phase-1]] (`.apl/plan/engine/phase-1.md`). All ten plan steps are merged on `main` (8 commits, 23d7840 to 012bdd6). `bun run check` passes on macOS arm64 with 255 tests.

## State

- Exit criteria 1 to 5 are covered by `test/determinism.test.ts`, `test/core-boundary.test.ts` and the toy system, and pass locally.
- The plan defines "done" as passing in CI on macOS and Linux. That hasn't happened: the repo has no remote and `gh` isn't installed, so `.github/workflows/ci.yml` has never run.

## Next steps

1. Deferred by Garret on 2026-10-28: create a GitHub repo, push `main`, and confirm the CI matrix (macOS and Ubuntu) is green. The Linux run is also the first Linux install of OpenTUI.
2. Eye-test the OpenTUI spike on Linux x64 (render, keypress, terminal restore). See `docs/spike-opentui.md`.
3. Then start phase 2 (TUI). The lead decisions in the plan (10 ticks per second, named RNG substreams, macOS arm64 plus Linux x64) were confirmed on 2026-10-28.

## Gotchas

- Worktrunk needs Git 2.43 or newer. Git 2.56 was installed with Homebrew at `/opt/homebrew/bin/git`; the system Git (2.39) makes `wt` refuse to run.
- `wt merge` runs `bun run check` as a pre-merge hook (`.config/wt.toml`).
- The golden hash (`test/golden.json`) changes with any intended behavior change. Regenerate it with `bun run golden:update` and say why in the commit message.
- The resource `+=` scan only matches a field literally named `resources`. An alias (`const r = state.posting.resources; r.x += 1`) gets past it.
- `--trace n` counts steps within the run, not absolute ticks.
- Later phases should run through the `/project-lead` skill (commit 035b594). The `implementer` (Sonnet) and `reviewer` (Opus) agent types only appear in a session started after that commit.
