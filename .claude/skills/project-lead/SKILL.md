---
name: project-lead
description: Lead a Steward phase or multi-step feature by splitting a plan into tasks, briefing Sonnet implementer subagents in worktrunk worktrees, sending each branch to an Opus reviewer, verifying independently, and merging. Use when the user asks you to lead, run, or delegate a phase or plan.
argument-hint: "[plan path or artifact link]"
---

# Project lead

You own the plan, the briefs, verification and merging. You write no feature code yourself: implementers write it, the reviewer judges it, and you decide what lands on `main`. Repo setup (configs, scaffolding, CI) and small fixes to your own docs are the exception.

## Before delegating

1. Load the `agent-plan:apl` skill. Find or create the plan in `.apl/plan/`. If the source is a claude.ai doc, read it with the docs tools and copy it into the apl plan so subagents can read it. Add a "Lead decisions" section for anything you decide on the user's behalf, and a progress table (step, branch, status).
2. Settle open questions that would change interfaces or the save shape before the step that depends on them. If the user is away, pick the plan's own recommendation, record it under "Lead decisions", and tell the user when they return.
3. Run any gating spike yourself first. A failed spike stops the phase.
4. Check the tooling: `wt` (worktrunk) needs Git 2.43 or newer; `.config/wt.toml` runs `bun install` on worktree creation and `bun run check` before merges.

## Split the work

- One task per branch. A task is the smallest unit that ends with its own tests passing.
- Run tasks in parallel only when they touch disjoint files and neither needs the other's code to compile. Otherwise sequence them: merge the dependency first, then branch from the new `main`.
- When parallel tasks meet at an interface, write the exact signatures into both briefs and name the files the other agent owns, so neither creates them.

## Write the brief

Each implementer starts cold, so the brief must stand alone. Include:

- Worktree path and branch, plus "do not touch other checkouts, do not merge, do not push".
- Read `CLAUDE.md` and the named sections of the apl plan first, and list the existing modules to read before writing.
- Exact exported signatures and file locations; where a choice matters to later steps, make it in the brief.
- The test list as invariants, not code. Only demand what can actually hold: don't ask for bit-identical results between two different algorithms, or for reference values derived from the code under test.
- Done criteria: `bunx biome check --write .`, then `bun run check` passing, then one commit with a plain-prose message ending in `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Report format: exported signatures, deviations and why, pasted `bun run check` tail. Say "do not send a placeholder".

## Spawn

- Create the worktree: `wt switch --create <branch> --no-cd -y`.
- Implementer: `Agent` with `subagent_type: "implementer"`, `run_in_background: true`, and **no `model` parameter**. The agent definition pins Sonnet, and a per-call `model` would override it.
- Launch independent implementers in one message so they run concurrently.

## Review loop

When an implementer reports back:

1. Treat the report as a claim. An empty, vague or placeholder report means you inspect the worktree yourself (`git log main..<branch>`, `git status`) before anything else.
2. Spawn the reviewer: `Agent` with `subagent_type: "reviewer"`, no `model` parameter, giving it the worktree path, branch, the full brief, and the implementer's stated deviations.
3. On "changes requested", send the findings to the **same implementer** with `SendMessage` (it keeps its context) and re-review after it commits. Don't fix the code yourself.
4. Judge deviations on merit. An implementer that departs from a wrong brief is right; update the plan to match.

## Verify, then merge

Before merging, check the branch's guarantee yourself in a way that doesn't trust the agents' tests:

- Recompute reference values with an independent implementation (for example, a short Python script).
- Run the CLI or app by hand and compare the outputs.
- For a test that guards an invariant, plant the bug it should catch, confirm it fails, then `git checkout` the file and confirm the tree is clean.

Then run `wt merge -y` from the worktree. It rebases, runs `bun run check` through the pre-merge hook, fast-forwards `main` and removes the worktree. Show the pass count and the merged commit hash, and update the apl progress table.

## Finish

- Run `bun run check` on `main` and show the result.
- Write an apl handoff with what's done, what isn't verified (for example CI never ran), next steps and gotchas.
- Report to the user: the outcome first, then how you verified it, the decisions you made for them, and what's left.
