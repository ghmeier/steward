# Steward

Steward is a TUI incremental game. Phase 1 is a headless deterministic engine; the plan lives in `.apl/plan/engine/phase-1.md` (load the `agent-plan:apl` skill before reading `.apl/`).

## Commands

- `bun run check`: typecheck, Biome lint, and `bun test`. Must pass before any merge.
- `bun test test/<file>.test.ts`: one file.
- `bunx biome check --write .`: format and apply safe lint fixes.

## Core rules (src/core/)

The core is pure and deterministic. It must not:

- import anything outside `src/core/` (no `node:`, `bun:`, `fs`, `@opentui/*`, or `../` imports);
- use `Date`, `Math.random`, `performance`, `setTimeout`, `setInterval`, `process`, `Bun`, or `crypto`;
- use `Math.pow`, `**`, `Math.log*`, `Math.exp*`, trigonometric functions, `Math.cbrt`, or `Math.hypot`. Use `powInt` for integer powers;
- add to a resource with `+=`. Every resource change goes through the `add` helper so absorbed additions are recorded;
- rely on object insertion order. Iterate records in sorted key order.

State is plain JSON data: no `Map`, `Set`, classes, `undefined`, `NaN`, `-0`, or `Infinity`. The core receives tuning as an argument and never reads `data/`.

Biome enforces the import and global rules; `test/core-boundary.test.ts` is the backstop and also covers what Biome cannot (`**`, banned `Math` members).

## Conventions

- TypeScript strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Tabs, double quotes (Biome).
- Tests live in `test/`, named by subject and expected behavior, arrange/act/assert separated by blank lines.
- Comments explain why, never what.
- SHA-256 via `Bun.CryptoHasher` (outside the core only), never `Bun.hash`.
