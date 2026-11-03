---
title: "Village UI today: four-panel grid, overlays and the command line"
status: final
tags: [tui]
created: 2026-11-03
updated: 2026-11-03
---
# Village UI today: four-panel grid, overlays and the command line

Context for [[plan/tui/village-layout]], from Garret's `REFINEMENTS.md` (2026-11-03).

## Layout

- `src/tui/panels.ts` builds a 2×2 grid: Ledger and Crown on top, Desk and Peasants below, plus a 2-line text footer (message, then key hints). `createPanels` returns `update(view, footer, selectedId)` and `showMenu(render | null)`.
- Any menu or the command line **replaces** the grid (`grid.visible = false`). This is why settling a dispute hides the resources.
- The Crown panel is always locked. `CROWN_PANEL` (`panel.crown`) is not in `data/archive.json`, so nothing can buy it. It is a placeholder for phase 6.
- `peasantRowCapacity` derives the Peasants inner height from `renderer.height`, because OpenTUI lays out lazily. Any layout change must update that arithmetic.

## Input

- `src/tui/app.ts` `onKeyPress` dispatches in this order: the open command line, then the open menu, then `actionForKey`.
- `src/tui/keys.ts`: `BINDINGS` maps keys to actions, some gated by an unlock (`a` needs `ARCHIVE_PANEL`, `:` needs `PALETTE_UNLOCK`). `KEY_HINTS` feeds both the footer and Help's Keys topic. Kitty terminals report `?` and `:` as shift plus `/` and `;`, which `nameOf` handles.
- The keys used now are j, k, up, down, f, w, m, i, a, d, c, :, ?, n, s and q. l and p are free.

## Menus

- `src/tui/menu.ts` is a stack of screens (`list` or `number`), rebuilt from the live view on every key. `renderMenu` returns `{ title, lines, hints }`.
- It has three users: `court-menu.ts` (list the disputes, push one, choose an option, which runs `settleDispute`), `help-menu.ts` (a list of 8 topics, each pushing a text screen) and `new-game-menu.ts` (a yes/no confirmation).

## Command line

- `src/tui/command-line.ts` (825 lines): `openLine(prefill)`, `lineKey`, `renderLine`. The render is `: text_`, up to `MAX_SUGGESTIONS_SHOWN` suggestions, a `!` problem line, a blank line, then the decrees in force. It has verbs for decree, repeal, buy, save, enact and forget.
- `d` opens it with `decree ` typed, `a` with `buy ` typed, and `:` empty.

## OpenTUI 0.8 options that matter

- `BoxRenderable` takes `borderStyle` (single, double, rounded or heavy), `borderColor`, `title` and `bottomTitle`. That is enough to mark a focused panel and to put in-panel hints on the bottom border.
- Renderables take `position: "absolute"` and `zIndex`, so the command bar can grow upward over the grid instead of resizing it.

## Decisions (Garret, 2026-11-03)

- The tech-debt item is already done. Tests were moved next to their sources in 0a6b8d6.
- A is the Archive. The Crown panel is dropped until phase 6.
- The command bar grows upward over the grid while typing. The Decrees panel shows the decrees in force.
- The Ledger is not interactive. "(L)edger" is a label, and the panel just uses its width better.
