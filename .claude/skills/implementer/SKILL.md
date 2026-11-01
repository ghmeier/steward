---
name: implementer
description: How an implementer subagent turns a task into one committed, tested branch in its worktree.
user-invocable: false
---

# Key Principles

1. **Think before coding**: Understand the task and patterns fully before writing anything
2. **Verify**: When possible, write tests _before_ you implement the code so you can verify
   as you go. When making changes to the UI, perform visual verification with the dev servers.
3. **Reuse patterns**: Find similar implementations and follow them exactly
4. **Stay in your worktree**: All code changes happen inside the worktree directory

# Workflow

## 1. Understand the Task

Review: task, objective, files to modify, patterns to follow, acceptance criteria. If unclear, check referenced files or ask the user before starting.

## 2. Set Up Worktree

Use `wt switch --create` and never raw `git checkout -b` or `git worktree add`. Worktrunk's pre-start hooks handle dependency installation and env setup that raw git commands miss. For example:

```bash
# Creates branch from main and enters worktree
wt switch --create X-descriptive-name

# For stacked changes, create from parent branch instead:
wt switch --create X-descriptive-name --base Y-parent-branch
```

### 3. Explore and Plan

Before writing code:

- Read referenced example files to understand patterns
- Search for similar implementations with `Glob` and `Grep`

**Explore in batches** One tool call should answer one whole question:

- First locate the file: `grep -n` for the symbol(s) across the relevant directory in a single call with alternation (`grep -nE 'foo|bar|baz' brochure/usecases/`).
- Read a file once. Use `Read` with `offset`/`limit` for files over ~300 lines, covering every range
  you need in one call.
- When you need several ranges from one file, pass them all to one `sed -n '10,40p;120,160p'` call.
- Questions that span more than ~5 files should use an `Explore` agent rather than answering them yourself.

### 4. Implement

When writing code, keep the following principles in mind:

- **Reuse what exists:** Before writing new logic, look for similar patterns. The right implementation is usually shorter than you'd expect because someone already built the building block.
- **Trust the type system:** Rely on database field constraints (`null=False`), filters, and type annotations to communicate invariants. Write code that reflects actual data contracts rather than hedging against hypothetical states.
- **Code prose:** The dispatch prompt and plan use bullet/arrow/ticket shorthand. That register must not appear in code. Comments and docstrings are complete sentences following the Comments and Tests rules in CLAUDE.md.

### 5. Write Tests

Test should earn their keep, testing bundles of functionality and avoiding duplicative or self-evident assertions. Test should verify functionality rather than be an exhaustive description of the system. Shared fixtures go in `test/helpers.ts` or `test/fixtures/`; one-off setup stays local.

### 6. Verification

Verify your changes exactly once before committing by running linting, type checking and targeted tests.

## 7. Finish

Make one commit on your branch with a message stating what changed and why, ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Keep commit messages clear and aimed at an audience of future code-readers.

Finish with a message reporting any deviations from the plan.

# When changes are requested

The lead forwards the findings. Fix every one you agree with. For one you disagree with, say why in your reply instead of changing it. Then rerun `bun run check`, commit, and report again.
