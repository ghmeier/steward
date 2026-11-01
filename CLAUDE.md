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

## Tests

Every implementer reads the tests before changing an area, so test size is paid again on every task. Keep the suite small and sharp:

- Test behavior through public entry points (`step`, `apply`, `computeView`, `parseLine`, the app harness). Don't add a test for a helper that an entry-point test already exercises.
- A test earns its place by catching a plausible bug no other test catches. Before adding one, name that bug; before deleting one, check another test still catches it. Line coverage doesn't show this.
- Prefer one `test.each` table over several near-identical tests. A row that asserts a problem names its path and a distinguishing fragment (`tuning.archive: repeats id`), so the row proves its own rule.
- Data shapes are declared with `src/core/schema.ts`. Don't write per-field rejection tests; `test/schema.test.ts` covers the combinators. Test only cross-field rules.
- Don't pin UI copy word for word. Assert the values shown, tied to their noun (`"grain at 0.25"`).
- Exactly one golden test (`test/golden.json`).

## Conventions

- TypeScript strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Tabs, double quotes (Biome).
- Tests live in `test/`, named by subject and expected behavior, arrange/act/assert separated by blank lines.
- Comments explain why, never what.
- SHA-256 via `Bun.CryptoHasher` (outside the core only), never `Bun.hash`.
