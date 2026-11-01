---
title: "Steward: Phase 2 implementation plan (minimal TUI)"
status: completed
tags: [phase-2, tui]
created: 2026-10-28
updated: 2026-11-01
---
# Steward: Phase 2 implementation plan (minimal TUI)

Source: phase 2 of the development plan (https://claude.ai/artifact/W1LESSbnonaotUx1qEu93J, Garret Meier, 2026-10-25), with the game design doc (https://claude.ai/artifact/NgCC6Q1LNo423bMujycHiV) for panel content. The development plan wins if this copy disagrees. Phase 1 is in [[plan/engine/phase-1]].

## What the development plan says

Phase 2, verbatim: "**Minimal TUI.** OpenTUI panels for ledger, desk, governors and crown, single-key input, and the render loop. Exit: the panels show live state and keys issue commands."

Architecture rules from the development plan that phase 2 must respect:

- **Simulation core.** All game logic is in the headless core; the TUI only sends commands and renders snapshots. The wall clock only decides how many fixed steps to run, never how long a step is.
- **Commands.** Every player input becomes a command object. One input path for keys, the later type-ahead builder and the later command palette, so replays and tests are trivial.
- **Reality versus appearance.** State holds true values only. Everything the player sees passes through a computed view (truth, plus illusion, plus governor exaggeration, filtered by unlocks). The TUI never reads truth directly.
- **Unlock registry.** Commands, key bindings and panels will check one registry (phase 5). Phase 2 shows everything.
- **Render loop.** Rendering runs separately from the simulation tick and redraws only when the view changes. The tick rate is a tuning value, not a frame rate.
- **Save file rules.** The game saves on an interval, on exit and on interrupt signals, writing atomically (phase 1 built `saveGame` and `loadGame`).
- **OpenTUI dependency.** The library is young; keep the TUI a thin client to limit the cost of switching.
- Phase 1 risk note: "In-place mutation needs the phase 2 view to copy." Phase 1 save note: "in raw mode Ctrl-C arrives as a keypress, not SIGINT."

Panel content, from the design doc: ledger (resources and rates), desk (pending events), governors, and the crown's current demand.

## Scope and exit criteria

Phase 2 delivers `bun run play`: a terminal app that loads or creates a save, runs the simulation in real time, shows four panels and a footer, turns single keys into commands, and saves on an interval, on quit and on signals.

Only the toy system exists, so the ledger is the only panel with live content. The desk, governors and crown panels render their (empty) view sections with a placeholder line; phases 4, 6 and 8 fill them. Inventing desk or crown state now would pre-empt those phases.

Phase 2 is done when:

1. `bun run play` opens the four panels and a footer; the ledger amount and the in-game clock advance on their own.
2. Pressing `+` or `-` changes the toy growth rate through a command, and the ledger rate updates. A rejected command (rate below zero) shows its reason in the footer.
3. `q` and Ctrl-C save and exit with the terminal restored; SIGINT, SIGTERM and SIGHUP do the same. A save that fails to parse is never overwritten.
4. The commands a session issued, replayed with `runSteps` from the session's starting state, reproduce the saved state's hash. This proves keys use the same command path as the runner.
5. The view is a fresh copy: stepping the state after computing a view leaves the view unchanged.

Out of scope: unlock filtering, detail levels, the command line, pause, mouse input, writing the session command log to disk, and Linux eye-testing (CI is still deferred; see [[handoff/engine/phase-1-review]]).

## Lead decisions (2026-10-28, made while Garret was away; confirm on return)

- **Headless TUI tests.** `@opentui/core/testing` exports `createTestRenderer` (frame capture with `captureCharFrame`, `waitForFrame`, mock keys). The lead's spike confirmed it works under `bun test` on macOS arm64. It must be created with `exitOnCtrlC: false`; with the default, a mock Ctrl-C destroys the renderer and the next capture throws `WrongContext`. Key names seen in the spike: `+` is `"+"`, space is `"space"`, Ctrl-C is name `"c"` with `ctrl: true`.
- **No `@opentui/keymap`.** The development plan lists it only as a candidate. A ten-line key table in `src/tui/keys.ts` avoids a second young dependency, and phase 5's unlock registry can gate the table directly.
- **New core command `adjustToyRate { delta }`.** The key handler must not read truth to compute an absolute rate, so the core does the arithmetic. A result below zero or above `maxResourceValue` is rejected, not clamped, so the rejection path is visible in the footer. `setToyRate` stays for the runner and the golden log.
- **The view lives in the core** (`src/core/view.ts`), since phases 7 and 8 add illusion and exaggeration there and it must stay deterministic. In phase 2 it is truth only.
- **Ledger rate** is the steady production rate (the toy growth converted to per second), not a measured delta, so random toy losses don't make it flicker.
- **Client settings are constants in `src/tui/`, not tuning**: frame poll interval 50 ms, autosave every 30 s of wall time, rate key step 0.5 per tick. Tuning is simulation input and part of the content hash.
- **Ledger rate test tolerance.** The step 1 test uses `stepMs` 250, which can't tell `g * (1000 / stepMs)` from `(g * 1000) / stepMs` in the last bit. The code uses the specified formula; not worth another round.
- **New game seed** is a random uint32 from `crypto.getRandomValues` (outside the core).
- **Startup with a bad save**: a version-refused save is already renamed by `loadGame`; the app starts a new game and says so in the footer. An invalid save stops the app before the renderer starts, prints the error and exits 1, so autosave can't overwrite it.
- **Live play skips per-tick validation** (`validate: false`, `absorbed: null`), matching the runner's quiet mode. Tests turn validation on.

## Interfaces

These are fixed for all briefs.

```ts
// src/core/commands.ts (added)
| { type: "adjustToyRate"; delta: number }

// src/core/view.ts
export type LedgerLine = { resource: ResourceId; amount: number; ratePerSecond: number };
export type DeskEntryView = { id: string; label: string };
export type GovernorView = { id: string; name: string };
export type CrownDemandView = { label: string };
export type GameView = {
  tick: number;
  elapsedSeconds: number;          // tick * stepMs / 1000
  ledger: LedgerLine[];            // one line per resource, sorted by resource id
  desk: DeskEntryView[];           // [] until phase 6
  governors: GovernorView[];       // [] until phase 4/8
  crown: CrownDemandView | null;   // null until phase 6
};
export function computeView(state: GameState, tuning: Tuning): GameView;

// src/tui/session.ts (no OpenTUI imports)
export type Rejection = { tick: number; command: Command; reason: string };
export type FrameResult = { steps: number; rejections: Rejection[]; viewChanged: boolean };
export type Session = {
  readonly state: GameState;                 // live state, for saving only
  readonly commandLog: readonly CommandLogEntry[];
  enqueue(command: Command): void;
  frame(): FrameResult;
  view(): GameView;
};
export function createSession(options: {
  state: GameState; tuning: Tuning; now: () => number;
  maxStepsPerFrame?: number; validate?: boolean;
}): Session;

// src/tui/keys.ts (no OpenTUI imports)
export type KeyPress = { name: string; ctrl: boolean; meta: boolean; shift: boolean };
export type KeyAction = { kind: "command"; command: Command } | { kind: "save" } | { kind: "quit" };
export const RATE_KEY_STEP = 0.5;
export function actionForKey(key: KeyPress): KeyAction | null;
export const KEY_HINTS: readonly { keys: string; label: string }[];

// src/tui/format.ts
export function formatAmount(value: number): string;
export function formatRate(perSecond: number): string;
export function formatGameTime(seconds: number): string;

// src/tui/panels.ts
export type Panels = { update(view: GameView, footer: string): void };
export function createPanels(renderer: CliRenderer): Panels;

// src/tui/app.ts and src/tui/main.ts: see step 4.
```

## Task order

Step 1 first (everything compiles against it); steps 2 and 3 in parallel on disjoint files; step 4 last.

1. **`view`**: `adjustToyRate` command (apply and `parseCommand`) and `src/core/view.ts`.
2. **`session`**: `src/tui/session.ts` and `src/tui/keys.ts`. Session wraps `createClock`, queues commands into the next step, logs `{ tick, command }` with the tick the command ran in, reports rejections, and detects view changes by comparing `JSON.stringify` of successive views. (`canonicalStringify` refuses `null`, which is right for saves, and `crown` is `null`; `computeView` builds every object with a fixed key order and a sorted ledger, so plain `JSON.stringify` is deterministic here.)
3. **`panels`**: `src/tui/format.ts` and `src/tui/panels.ts`. Two-by-two layout (ledger, crown, desk, governors) and a footer line; placeholder lines for empty sections. Tested with `createTestRenderer`.
4. **`app`**: `src/tui/app.ts` (startup load or new game, frame timer, key wiring, autosave, idempotent shutdown that saves, destroys the renderer and awaits `closed`), `src/tui/main.ts` (real renderer with `exitOnCtrlC: false`, signal handlers, exit codes), `play` script in `package.json`.

## Risks

- **OpenTUI test renderer is undocumented API.** It ships in the package's `exports`, but may change between versions. Versions are pinned.
- **Shutdown races.** A signal during an autosave, or two quit paths at once, could save twice or exit before the renderer restores the terminal. Shutdown must be idempotent and ordered: stop timers, save, destroy renderer, await `closed`, exit.
- **Closed terminal hangs shutdown (found 2026-10-28).** When the terminal window closes, SIGHUP arrives, but after `renderer.destroy()` no JavaScript timer fires again: the main thread spins in Bun's event loop on the dead terminal, so `renderer.closed` and any timeout race never settle and the process burns 100% CPU. Confirmed by sampling and with a bare OpenTUI probe. Fix: SIGHUP takes a separate path (`app.hangUp()`) that saves synchronously and calls `process.exit` without touching the renderer. A bounded wait on `closed` was tried first and does not help.
- **Linux is still unverified** for rendering and keys (no CI run yet).

## Progress

| Step | Branch | Status |
| --- | --- | --- |
| 0 test renderer spike | lead (main) | done: works with `exitOnCtrlC: false` |
| 1 view and adjustToyRate | `view` | merged ec36403; planted bugs (hardcoded 10 ticks per second, missing finite check) fail the tests |
| 2 session and keys | `session` | merged 39a3210; a session's command log replayed through `bun run sim` reproduces its hash (da520dd8 at tick 148); a planted off-by-one log tick fails the replay test |
| 3 format and panels | `panels` | merged 5a2b517; `formatAmount` matched an independent Python implementation on 3,014 values; removing the column padding fails the alignment test |
| 4 app, main, play script | `app` | merged 942b3e8; verified by hand in tmux: keys, footer messages, resume, corrupt-save refusal, and every exit path (q, Ctrl-C, SIGINT, SIGTERM, SIGHUP, window close) |
| 5 cleanup and refactor pass (requested by Garret, Opus implementer) | `cleanup` | merged 72f4e6e (worktrunk squashed the three commits; message reworded); sim output, error output, save files (apart from `savedAt`), a non-empty absorbed summary and a rendered screen are byte-identical to `main` before the merge |
