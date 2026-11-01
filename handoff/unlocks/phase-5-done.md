---
title: "Phase 5 merged: command line, unlocks and the Archive"
status: open
tags: [phase-5]
branch: main
created: 2026-11-01
updated: 2026-11-01
---
# Phase 5 merged: command line, unlocks and the Archive

## Context

Continues [[plan/unlocks/phase-5]], now completed. All work is on `main`:

| Commit | Step |
| --- | --- |
| 66986d4 | Unlock registry and the Archive in the core; schema 8; `--grant` in the simulator |
| 0d456fd | Saved decrees in the core |
| 80d7de3 | Type-ahead command line replaces the decree menu |
| 1221fe9 | Command palette, the Archive door, and unlock-gated keys, hints, help and verbs |

`bun run check` passes on `main` with 954 tests.

## Done

- Every control beyond the phase 4 kit appears only once owned. The Archive opens through play at the first coin; the palette (100), saved decrees (250, needs the palette), compound conditions (400) and chaining (800) are bought there.
- `d` opens the command line with `decree` typed, `a` with `buy` typed, and `:` empty (the palette). The line lists the decrees in force.
- The tutorial stub records the first tick each control is needed in `career.needed`; nothing reads it yet.
- Verification per step is in the plan's Progress table: independent simulator runs for purchases and saved decrees, planted bugs for every gate, Garret's decrees retyped by hand and compared, and a tmux exit check on scratch saves.

## Not verified

- CI has still never run (no remote).
- A real kitty-protocol terminal. The tests use OpenTUI's kitty mock, and tmux does not speak the protocol. Typing `:` and capital letters in Ghostty, kitty or WezTerm is worth one manual try.
- Prices are a first guess from one strategy's income (about 66 coin a minute at 40 peasants). Garret's save can buy everything at once.

## Next steps

1. Garret: playtest. The Archive is already open in your save, with 73,932 coin.
2. The UX pass, done as one piece. Candidates collected this phase:
    - the command line is a full-screen overlay with plain styling;
    - the court is still a menu, and could become a `settle` verb;
    - `assign` is overridden every tick while a labor decree is in force, so it looks broken (it worked in the tmux check, and the decree moved the peasant straight back);
    - fold the promotion notice into the unlock-notice pattern.
3. Phase 6, desk and crown demands. Coin now has a sink; quotas will compete with the Archive for it.

## Gotchas

- **Saves on macOS:** the TUI ignores `XDG_DATA_HOME`. Use `STEWARD_SAVE_DIR` for every manual run. An implementer's run overwrote Garret's real save on 2026-10-31. It was restored from `save.json.bak` with his consent, and the damaged files are snapshotted in that session's scratchpad.
- `wt merge` squashes under the message "Squash commits from <branch>". Amend the message on main after each merge.
- `decreeLine` throws for conditions the line cannot express (nested compound conditions, one-part compounds). It has no caller in `src/` yet; any future caller must catch.
- `sampleVillage` in `test/helpers.ts` grants every Archive unlock. Gating tests use `createNewGame` and `grantUnlocks`.
- The golden run passes `--grant` for every Archive entry, so the command-log fixture still exercises chained decrees. A golden change is a bug to explain, not a fixture to refresh.
- Garret's three edited `.claude/skills` files are still uncommitted on main, on purpose.
