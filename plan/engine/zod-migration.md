---
title: Replace the in-house schema module with Zod
status: active
tags: [engine, validation]
created: 2026-11-01
updated: 2026-11-02
next_step: Refactor pass running on zod-migration; then PR to main
---
# Replace the in-house schema module with Zod

## Goal

`src/core/schema.ts` (313 lines plus 165 lines of tests) is a hand-written parsing library: `integer`, `number`, `string`, `literal`, `array`, `object`, `keyedBy`, `record`, `refine`, `custom`, `tuple`, `variant`, `lazy`, and `parse`/`problemsOf`. Replace it with Zod (REFINEMENTS item 1) and delete the module. Behavior must not change: `test/golden.json` passes without regeneration, and `SCHEMA_VERSION` stays 8.

## Decisions (2026-11-01, with the user)

- Zod 4.6.7 (released 2026-10-12), pinned exactly, as a runtime dependency.
- `zod` is the single allowed import from outside `src/core` in core code. Update both the boundary test (`src/core/core-boundary.test.ts`) and the Biome `noRestrictedImports` override in `biome.json`. Zod is pure and deterministic, so the rule's intent (no I/O, clocks or randomness) holds.
- Errors keep the `path: message` shape, using Zod's own message text. One formatter builds it; tests that pin the old wording are updated.

## Consumers

| File | Uses the schema module for |
| --- | --- |
| `src/core/decree.ts` | `decreeSchema`, the recursive condition tree (`lazy`), `parseDecree(value, limits)`; limits checks (rule count, node count, depth) |
| `src/core/commands.ts` | `commandSchema` (`variant` on `type`), `opaqueDecree` (`custom`), `commandLogSchema` (`refine` for ascending ticks) |
| `src/core/validate.ts` | The full `GameState` schema with `tuple`, `record`, `refine`; `scanPlainData` is not schema code and stays |
| `src/core/tuning.ts` | `parseTuning`, including `keyedBy` for season and resource tables |
| `src/runner/strategy.ts` | Strategy file parsing |

## Implementation

Branch `zod-migration` off `main`. One PR, in commits:

1. **Dependency and boundary.** `bun add zod@4.6.7` (exact). Allow `zod` in the boundary test and in the Biome override; keep every other outside import banned, and add one case to the boundary test's self-check showing `zod` passes while another package fails.
2. **Formatter.** A single function in core (for example `formatIssues(error, root)` in `src/core/errors.ts`, next to `errorMessage`) that renders each Zod issue as `<root><path>: <message>`, with array indexes as `[n]` and keys as `.key`, joined with `"; "` as `parse` does today. A small parse helper (for example `parseWith(schema, value, root)`) throws an `Error` with that text, replacing `parse`. `problemsOf` callers use `safeParse` and the same formatter.
3. **Port each consumer** with these mappings:
   - `object(shape)` becomes `z.strictObject(shape)`, since unknown keys are rejected today. Optional keys use `.optional()`; with `exactOptionalPropertyTypes` on, confirm the inferred types still match the hand-written ones (`Decree`, `Tuning`, `GameState`), or derive those types with `z.infer` where that is simpler.
   - `keyedBy(keys, v)` becomes `z.record(z.enum(keys), v)`, which Zod 4 treats as exhaustive, or a `z.strictObject` built from the keys.
   - `variant(tag, ...)` becomes `z.discriminatedUnion(tag, [...])`.
   - `refine(schema, rule)` becomes `.superRefine`, adding issues with the same messages the rules push today.
   - `custom(parser)` becomes `z.unknown().transform` (or `z.custom`), keeping the structured-clone behavior of `opaqueDecree`.
   - `literal(...values)` becomes `z.enum(values)`. `tuple` becomes `z.tuple`. `integer` becomes `z.int()` with `.min`/`.max`. `number` becomes `z.number()` (finite by default in Zod 4) with bounds. `string({ pattern })` becomes `z.string().regex()`.
   - `lazy` becomes `z.lazy`. See the recursion risk below.
4. **Delete** `src/core/schema.ts` and `src/core/schema.test.ts`. Move any invariant those tests covered that the app still depends on (for example, recursion depth limits or unknown-key rejection) into the consumer tests.

## Acceptance

- `bun run check` passes.
- `bun test src/core/determinism.test.ts` passes; `test/golden.json` is unchanged.
- `grep -rn 'core/schema\|"./schema"' src scripts test` finds nothing.
- Error-path tests in `validate.test.ts`, `decree.test.ts`, `commands.test.ts`, `save/content.test.ts`, `tui/command-line.test.ts`, `unlocks.test.ts`, `unlock-gating.test.ts` assert the new `path: message` text, and every rejection the old tests checked is still rejected.
- Manual check: in the TUI (with `STEWARD_SAVE_DIR` pointed at a scratch directory), type an invalid decree on the command line and confirm the error reads as `path: message`.

## Review patterns

- One formatter; no per-call-site string building of Zod errors.
- No translation table from Zod issue codes to the old phrasing (the user chose Zod's wording).
- Schemas stay module-level constants; parsing does not become a class. The pure-function decision from the class refactor holds for validation.
- Comments are why-only; no references to this migration in code.

## Risks

- **Recursion depth.** The old `lazy` stopped at 64 levels, and `parseDecree` enforces `maxConditionDepth` after parsing. `z.lazy` has no cap, so a deeply nested decree or save from an untrusted file could overflow the stack before the depth limit runs. Keep a cheap depth check before Zod sees condition trees (or a `superRefine` that bails early), and keep a test that a very deep condition is rejected with a message rather than a crash.
- **Issue order.** The old `record` and `object` checks sorted keys so problem order was deterministic. Zod reports in shape order and input order. Tests that compare a full joined message with several problems may need to assert with `toContain` per problem. Nothing hashed depends on error order.
- **Copy semantics.** `parse` returned values sharing no objects with the input. Zod builds new objects and arrays for parsed objects, but transforms and `z.unknown()` pass values through; `opaqueDecree` must keep its `structuredClone`.
- **Number edge cases.** The old `number()` rejected non-finite values and `validate.ts` rejects negative zero in `scanPlainData`. Confirm Zod 4 rejects `Infinity` and `NaN` by default, and leave the negative-zero scan in place.

## Notes and decisions

- 2026-11-01: Plan drafted after the class refactor merged (PR #1, `62057db`).
- 2026-11-01: User approved. Dispatched one implementer on `zod-migration`.
- 2026-11-01: Implementation done on `zod-migration` (`5c0cfeb` dependency and boundary, `9c73805` port and delete). Verified: `bun run check` 806 pass, golden unchanged, no schema imports, no casts in core. Depth guard caps at 64 levels before `z.lazy`; 10,000-level decree rejected through `parseDecree` and `validateState`.
- 2026-11-01: Finding: the command-line grammar rejects malformed decrees before `parseDecree` runs, so players meet Zod's wording mainly on save or tuning load failures, not while typing decrees. Unknown keys now report at the parent path (`decree: Unrecognized key: "extra"`), and missing keys read as `expected string, received undefined`.
