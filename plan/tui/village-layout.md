---
title: "Village UI overhaul: five focusable panels and a command bar"
status: active
tags: [tui]
created: 2026-11-03
updated: 2026-11-03
next_step: PR 1 (village-layout) in progress with an implementer
---
# Village UI overhaul: five focusable panels and a command bar

Research: [[research/tui/village-layout]]. Source: Garret's `REFINEMENTS.md`, 2026-11-03.

## Goal

The village phase plays on one screen. Settling a dispute, buying from the Archive, or writing a decree happens inside a panel, while the resources and peasants stay visible. The key hints move from a crowded footer into the panel that uses them. The bottom bar holds the message, a short "(?)Help (N)ew village (Q)uit" list, and the command line.

```
┌(L)edger┐┌(P)easants┐┌(A)rchive──────────┐
│        ││          ││                   │
└────────┘└──────────┘└───────────────────┘
┌(C)ourt─────────────┐┌(D)ecrees──────────┐
│                    ││                   │
└────────────────────┘└───────────────────┘
Saved.                (?)Help (N)ew village (Q)uit
```

The top row splits 1 : 1 : 2, and the bottom row 1 : 1. The rows are equal height. The Crown panel leaves the layout until phase 6.

## Interaction model

- **Focus.** p, a, c and d focus the Peasants, Archive, Court and Decrees panels. Esc clears focus. Pressing another panel's letter while focused moves focus there. l is unbound, because the Ledger is not interactive.
- **Focused look.** The focused panel uses `borderStyle: "double"` and an accent `borderColor`. Its hints sit on its `bottomTitle`, for example `j/k select · f/w/m/i assign · esc back`. Unfocused panels have no selection marker and no hints.
- **Panel keys come first.** While a panel is focused, its own keys win over global ones. No panel claims p, a, c, d, n, q, s, ? or :, so those stay global everywhere.
- **Behavior change.** j, k, f, w, m and i work only while Peasants is focused. Today they work all the time. This follows the proposal (the hints live in the interactive view), but it is a change for existing players.

| Panel | Unfocused | Focused keys |
| --- | --- | --- |
| Ledger | Resources, rates, realm lines. Lines must fit a quarter-width column, so wrap or shorten `Next peasant` and `Promotion`. | none |
| Peasants | Names and jobs, no cursor | j/k select, f/w/m/i assign |
| Archive | Entries with prices and owned state. "Locked." until `ARCHIVE_PANEL`, and `a` does nothing until then. | j/k select, enter buys |
| Court | The disputes waiting, or "The desk is clear." | j/k select, enter opens that dispute's options in the same panel, enter settles, esc goes back a level |
| Decrees | One row per petition (harvest, wood, ore, labor) with its decree or "none" | j/k select, enter opens the command line with `decree <petition> ` typed, x repeals the selected decree |

- **Help** opens with ?. It is one scrolling page with every topic expanded under its heading (j/k a line, space a page, esc or ? closes). It still replaces the grid, because it is reference text.
- **New village** keeps its yes/no confirmation through `menu.ts`.
- **s** still saves. It drops off the bar and stays listed in Help's Keys topic.

## Structure

Reuse what exists rather than writing new state machines:

- `menu.ts` keeps its screen stack. Court renders a `MenuState` inside its panel instead of as an overlay, so the dispute list, then options, then settle flow is the existing `courtMenu` builder, unchanged. `renderMenu`'s `hints` become the panel's `bottomTitle`. The Archive list can be a `menu.ts` list screen too.
- `cursor.ts` keeps driving the Peasants selection, and `rowWindow` still trims it to the panel height.
- `keys.ts` gains the focus bindings and a per-panel hint list. `KEY_HINTS` splits into global hints (the bar and Help) and panel hints.
- `panels.ts` becomes the five-panel layout. Each focusable panel is one small class with a shared shape (title, letter, body for a view and height, hints, and a key handler that returns commands or a request such as "open the line with this text"). `app.ts` holds `focus: PanelId | null` and dispatches in this order: line, overlay (Help or New village), focused panel, global keys.
- `PanelId` in `src/core/view.ts` swaps `crown` for `archive`, and `lockedPanels` reports `archive` until it opens. Phase 6 adds `crown` back.
- The Peasants height arithmetic in `peasantRowCapacity` changes with the layout. Keep deriving it from `renderer.height`.

## PRs

Two stacked PRs. PR 1 carries most of the uncertainty (layout, focus, OpenTUI styling), so it goes first. PR 2 needs PR 1's layout and bar, so they cannot run in parallel.

### PR 1: `village-layout` (from `main`)

Five-panel layout, focus, in-panel interaction, expanded Help and the new bar.

- [ ] Layout and titles as drawn above. Crown removed, Archive added.
- [ ] Focus with the double, accented border and `bottomTitle` hints. Esc unfocuses.
- [ ] Peasants, Court, Archive and Decrees interactions as in the table. Decrees' enter opens the **existing** overlay command line for now.
- [ ] Court settles inside the panel while the Ledger stays visible. Delete the court overlay path (`action.kind === "court"` opening a menu).
- [ ] Help is one expanded, scrolling page. Remove the topic list screen.
- [ ] Bottom bar: the message on the left, and `(?)Help (N)ew village (Q)uit` on the right (plus `: commands` once the palette is owned).
- [ ] Tests: focus switching and esc, panel keys ignored while unfocused, settling a dispute from the Court panel enqueues `settleDispute`, buying from the Archive panel, x repealing, help scroll. Each one is a small invariant in `app.test.ts` or the panel's own test file.

### PR 2: `village-command-bar` (from `village-layout`)

The command line moves into the bottom bar.

- [ ] `:`, and enter in the Decrees panel, open the line in the bar. While it is open, the bar becomes an absolutely positioned box (`position: "absolute"`, a high `zIndex`) anchored to the bottom. It grows upward over the grid to show suggestions and a `!` problem line, then collapses back to one line on enter or esc. The grid never resizes.
- [ ] `renderLine` drops the list of decrees in force, because the Decrees panel shows it. Its `title` and `hints` go to the bar.
- [ ] Remove the full-screen line overlay. `panels.showMenu` keeps serving only Help and New village.
- [ ] Tests: the grid stays visible while the line is open, and the bar's height follows the suggestion count and returns to one line after closing.

## Verification

- `bun run check` passes on each branch.
- A tmux run per PR against a scratch save (`STEWARD_SAVE_DIR=$(mktemp -d)`, never the default directory), at 100×30 and at 160×45. Use `tmux capture-pane -p` to show the grid, a focused panel, settling a dispute with the Ledger visible, and (PR 2) the bar grown over the grid. Paste the captures into the PR description.
- Not verifiable here: `:` and `?` in a real kitty-protocol terminal. Garret should try both once in Ghostty.

## Risks

- **Quarter-width Ledger and Peasants.** At 100 columns a quarter is about 23 inner columns. `Next peasant 12.3 / 50 grain (~1m 20s)` will not fit. Wrap these into two lines rather than truncating them.
- **OpenTUI absolute positioning** is unused so far in this repo. If it misbehaves, fall back to a bar whose height grows and shrinks the grid, and tell the lead.
- **Golden and determinism tests** must not change. This is UI only, and any change to the command log is a bug.

## Review patterns

- Comments are why-only, and no plan or ticket language goes into the code.
- Logic lives in small classes with methods that derive from properties, not module-level one-off helpers.
- Reuse `menu.ts`, `cursor.ts` and `keys.ts` before adding new state.

## Progress

| PR | Branch | Status |
| --- | --- | --- |
| 1 | `village-layout` | not started |
| 2 | `village-command-bar` | not started |

## Notes and decisions

- 2026-11-03: Tech-debt item dropped. Tests were already moved next to their sources (0a6b8d6).
- 2026-11-03: A is the Archive. The command bar grows upward. The Ledger is a label only.
