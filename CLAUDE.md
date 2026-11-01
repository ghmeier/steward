# Steward

Steward is a TUI incremental game.

## Commands

- `bun run check`: typecheck, Biome lint, and `bun test`. Must pass before any merge.
- `bun test test/<file>.test.ts`: one file.
- `bunx biome check --write .`: format and apply safe lint fixes.
