# Steward

Steward is a TUI incremental game.

## Commands

- `bun run check`: typecheck, Biome lint, and `bun test`. Must pass before any merge.
- `bun test src/<dir>/<file>.test.ts`: one file.
- `bun run test:sim`: the long strategy simulations in `src/runner/strategies.sim.ts`. They are slow, so neither `bun test` nor `bun run check` runs them; run them after changing tuning data, strategies or the runner.
- `bunx biome check --write .`: format and apply safe lint fixes.
