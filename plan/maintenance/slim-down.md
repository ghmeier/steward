---
title: Slim the codebase and the test suite to cut implementation cost
status: completed
tags: [maintenance, tests]
created: 2026-11-01
updated: 2026-11-01
---
# Slim the codebase and the test suite to cut implementation cost

## Goal

Make each future feature cheaper for an implementer to build, measured in what it has to read and write. No game behavior changes: `test/golden.json` stays byte-identical through every step.

Targets:

- Test code from about 10,750 lines and 954 tests to about 5,000 lines and 450 tests.
- `src/core/` validation code (today `tuning.ts`, `validate.ts`, and the parsers in `decree.ts`, `commands.ts` and `runner/strategy.ts`) roughly halved.
- Line coverage stays at or above 95% overall (baseline 98.3%, `bun test --coverage`).
- A new state or tuning field touches two files plus its tests, not five.

## What the research found

Measured on `main` at 1221fe9.

**The test suite is 1.7 times the size of the code.** There are 6,400 lines of source and 10,750 lines of tests. Recent feature commits added one to three lines of test for every line of code: the unlock registry added 531 lines of `unlocks.test.ts` for 132 lines of `unlocks.ts`, and the command line added 927 test lines for 885 source lines. Each implementer reads the relevant test files before adding to them, so test size is paid again on every task that touches an area.

**Validation is written five times by hand.** `tuning.ts` (560 lines), `validate.ts` (388), `parseDecree` in `decree.ts`, `parseCommand` in `commands.ts` and `parseStrategy` in `runner/strategy.ts` each have their own `record`, `exactKeys`, integer and range checks. Together they have about 150 `throw` or `problems.push` sites, and the tests pin most of them one at a time (`validate.test.ts` alone is 445 lines). This is why the famine change touched `state.ts`, `validate.ts`, `tuning.ts`, `save.ts`, `helpers.ts` and five test files for one new state field.

**The tests have four kinds of repetition:**

1. Per-field rejection tests for parsers and validators, for example "rejects a negative tick", "rejects a fractional tick", "rejects a season yield missing a season".
2. Primitive modules tested past their contract. Examples: `rng.test.ts` (20 tests) checks that state survives `structuredClone` and that a draw "returns a plain array", and `clock.test.ts` (18 tests) has three tests that each restate "steps sum without float loss".
3. The same TUI behavior checked twice, once in a unit file (`command-line.test.ts`, `keys.test.ts`, `help-menu.test.ts`) and again in `app.test.ts` (800 lines, 49 tests).
4. Help and panel copy pinned word for word. Every wording change then needs test edits.

**The module layout is mostly fine.** `src/core/` has 22 flat files averaging 290 lines with a clean import graph, and merging small files (`errors.ts`, `data.ts`, `realm.ts`, `promotion.ts`) would save very little. The real structural cost is the parallel validation layers above. The one oversized module is `src/tui/command-line.ts` at 885 lines.

**The process encourages growth.** The implementer skill asks for paired positive and negative cases for every invariant, briefs list tests one by one, and the reviewer can delete tests but has no size budget. The uncommitted edits to the three skills already loosen this. Step 5 finishes that work.

## Approach

1. Replace the hand-written parsers with one small schema module in `src/core/`. A schema describes a value's shape once, and the same description parses tuning, commands, decrees and strategies and validates saved state. Types are inferred from the schema, so each shape is written in one place. Then test the schema module once, and test each domain only for its cross-field rules (decree cycles, delegate id order, allocation shares summing to 1, initial population not above the cap).
2. Rewrite the large behavioral test files as tables. A command-line case is `(typed text, owned unlocks)` mapped to the expected command, problem or suggestions, so a new verb adds rows instead of tests.
3. Test through public entry points (`step`, `apply`, `computeView`, `parseLine`, the app harness) instead of each helper, and keep `app.test.ts` to one wiring test per door.
4. Change the project rules so the suite does not grow back.

### Lead decisions

- **In-core schema module, no dependency.** Libraries like Zod or Valibot would break the "core imports only from `src/core/`" rule, and the core needs parsing in `step` (validate), `apply` (decrees) and `parseCommandLog`. A combinator module of about 150 lines covers what the five parsers do today: objects with exact keys, records keyed by a closed set, arrays, bounded integers and numbers, string literals and unions, and a refine hook for cross-field rules.
- **Error messages keep their path form** (`tuning.economy.maxPopulation: ...`, `$.posting.economy: ...`) but may change wording. No test asserts a full message except the schema module's own tests.
- **The plain-data scan stays.** `scanPlainData` (rejecting `NaN`, `-0`, holes, class instances) is a separate concern from shape and remains as is.
- **Coverage is a floor, not the proof.** Each test-deletion step also plants bugs (see "Verification").

## Steps

| Step | Branch | Depends on | Touches |
| --- | --- | --- | --- |
| 1 | `slim/schema-tuning` | none | new `src/core/schema.ts`, `src/core/tuning.ts`, `test/schema.test.ts`, `test/state.test.ts`, the tuning blocks of `test/desk.test.ts` and `test/unlocks.test.ts` |
| 2 | `slim/primitive-tests` | none | `test/{rng,math,clock,serialize,format,cursor,paths,save}.test.ts`, migrations in `src/save/save.ts` |
| 3 | `slim/tui-tests` | none | `test/{command-line,app,keys,help-menu,panels,menu}.test.ts` |
| 4 | `slim/schema-state` | 1 | `validate.ts`, `decree.ts`, `commands.ts`, `runner/strategy.ts`, their tests |
| 5 | (lead, on `main`) | 1–4 merged | `CLAUDE.md`, the three skills |
| 6 | `slim/core-tests` | 4 | the remaining core test files |

Steps 1, 2 and 3 run in parallel because their files do not overlap.

### Step 1: schema module and tuning

- `src/core/schema.ts` API (fixed here because step 4 builds on it):
  - `type Schema<T>` with one method `check(value: unknown, path: string, problems: string[]): T`. It appends `"<path>: <message>"` strings for every problem it finds and returns a freshly built value that shares no objects with the input. The return value is meaningless when problems were added.
  - `type Infer<S>` extracts `T`.
  - `parse<T>(schema, value, path): T` throws one `Error` whose message joins every problem with `"; "`. `problemsOf(schema, value, path): string[]` returns the list.
  - Combinators: `object(shape, { optional?: keys })` with exact keys, where optional keys are omitted rather than set to `undefined`; `keyedBy(tuple, valueSchema)` for records whose keys are exactly a const tuple such as `RESOURCES`; `record(valueSchema)`, iterated in sorted key order; `array(itemSchema, { minLength? })`; `integer({ min?, max? })`; `number({ min?, exclusiveMin?, max? })`, always finite; `string({ nonEmpty?, pattern? })`; `literal(...values)`; `refine(schema, (value, path, problems) => void)` for cross-field rules; and `custom((value, path) => T)`, which wraps an existing throwing parser and turns its error into a problem.
  - Paths read like `tuning.economy.maxPopulation` and `tuning.village.names[3]`.
- Rewrite `parseTuning` on top of it. `Tuning` and its subtypes become `Infer<...>` aliases with the same exported names, so callers don't change.
- Tests: one table per combinator (accepts, rejects with path). Tuning keeps only "the shipped data parses" and the cross-field rules. Delete the per-field rejection tests in `state.test.ts`, `desk.test.ts` and `unlocks.test.ts`.
- Guarantee: `parseTuning(fullTuningJson)` is deep-equal before and after (the lead checks this with a script against `main`).

### Step 2: primitive tests

Rules, applied to each file:

- Keep published reference vectors, range and boundary contracts, and determinism.
- Delete tests of the runtime (`structuredClone`, JSON round trips of plain arrays), tests that restate another test with new numbers, and "returns a plain array" style shape checks.
- Merge rejection tests into one `test.each` table per function.

Expected result: `rng` 20 tests to about 8, `math` 21 to about 10, `clock` 18 to about 9.

### Step 3: TUI tests

- `command-line.test.ts` becomes tables: parse cases (text, unlocks, expected command or problem), suggestion cases (text, unlocks, expected suggestion labels), and a short list of key-handling tests for `lineKey`. Target: under 400 lines.
- `app.test.ts` keeps one test per door (each key that opens a screen, save and quit, new village, hang-up, startup paths) and drops behavior already covered by the unit files. Target: under 350 lines.
- `help-menu.test.ts`: replace the copy assertions with one table that checks each topic shows the tuned values it depends on, not exact sentences. `panels.test.ts`: merge the placeholder and locked-panel pairs into tables.
- Split `src/tui/command-line.ts` only if the table rewrite shows a natural seam (tokenizer and suggestions versus key handling). It is not required.

### Step 4: schema for state, decrees, commands and strategies

- Port `parseDecree`, `parseCommand`, `parseStrategy` and the shape half of `validateState` to `schema.ts`. Cross-field checks (decree set cycles and policy problems, delegate id order and uniqueness, `nextDelegateId`, unique living names) stay as named `refine` functions.
- `Command`, `Decree` and the `GameState` subtypes come from `Infer<...>` where that keeps the public type identical. Where inference gives a worse type (for example recursive `Condition`), keep the hand-written type and annotate the schema with it.
- Schema additions this step needs (found in the step 1 review):
  - `variant(tagKey, { [tag]: Schema })` for discriminated unions (`Condition` on `kind`, `Command` on `type`): checks the value is an object, reports an unknown tag at `<path>.<tagKey>`, then hands the value to that tag's object schema. Trying each variant in turn doesn't work, because exact-key objects would flood the problem list.
  - `lazy(() => schema)` for the recursive `Condition`, with an explicit `Schema<Condition>` annotation. Keep a depth guard so a hostile deeply nested save or command can't overflow the stack; node and depth limits can then be a `refine`.
  - `integer()` switches to `Number.isSafeInteger` (validateState requires it), and `number()` gets a way to reject `-0`.
  - Opaque `decree: unknown` command fields use `custom` with a deep copy.
- `validate.test.ts` shrinks to the cross-field rules plus one plain-data table. Target: under 150 lines.
- Guarantee: every save in `test/fixtures/` and a save written by `main` still load, and the golden test passes unchanged.

### Step 5: project rules (lead)

Update `CLAUDE.md` with a short "Tests" section, and align the three skills (keeping the user's uncommitted edits):

- Test behavior through public entry points. Don't add a test for a private helper that an entry-point test already exercises.
- New shapes go in `schema.ts` combinators; don't write per-field rejection tests.
- Prefer one table-driven test over several near-identical tests.
- A brief states its test budget (for example "at most 8 tests") and lists invariants, not test names.
- The reviewer counts test lines against source lines and flags a branch that adds more than about one line of test per line of code.
- Briefs quote the plan sections an implementer needs instead of asking it to read a whole phase plan.

### Step 6: remaining core tests

Apply the step 2 rules and the new `CLAUDE.md` rules to `decree-engine`, `unlocks`, `desk`, `economy`, `delegates`, `saved-decrees`, `decree`, `view`, `projection`, `step`, `commands` and `save`. Prefer `step`-level scenarios over helper-level tests where one scenario covers several helpers. Can split into two parallel branches (decree files; everything else).

### Found along the way

- `decreeLine` in `src/tui/command-line.ts` is exported but only the tests call it (step 3 review). Delete it, or wire it into the command line, in step 6.

- A save whose labor decree names an allocation later removed from `data/` still loads, because state validation has no tuning to check labor policies against. `runDecrees` then throws `unknown labor policy` mid-step in the TUI. Untested on `main` too; needs its own ticket (step 6a review).

## Verification

For every step, before merging:

- `test/golden.json` is unchanged and the determinism test passes.
- `bun test --coverage` overall line coverage is at least 95%, and no source file drops more than 3 points from the baseline table below.
- Plant bugs. For each test file that lost tests, the lead plants three bugs in the code it covered, for example an off-by-one in a famine interval, a missing unlock gate, or a dropped `exactKeys` check, and confirms the remaining suite fails for each. Then `git checkout` and confirm a clean tree.
- For steps 1 and 4, compare outputs against `main` with a script: parsed tuning deep-equal, every fixture save loads to the same state hash.
- Record the test count and test line count after each merge in the progress table.

Baseline coverage (lines): 98.3% overall. Lowest files are `sim.ts` 96.7, `court-menu.ts` 89.8, `unlock-notices.ts` 89.5, `validate.ts` 92.9 and `save.ts` 93.0.

## User decisions (2026-11-01)

1. Drop the v6 to v7 and v7 to v8 save migrations and their tests. Older saves take the existing refusal path (moved aside to `save.v<n>.json`). Done in step 2.
2. The targets above (about 450 tests, about 5,000 test lines) are accepted.
3. Help and panel text is no longer pinned word for word.

## Risks

- Inferred types from the schema can be harder to read than hand-written ones. Mitigation: keep exported type names, and fall back to a hand-written type with the schema checked against it.
- Error wording changes may surface in the TUI (for example a refused save's message). Step 4 checks the refused-save and command-line problem paths by hand.
- Deleting tests can hide a regression that coverage doesn't show. The planted-bug check per file is the guard.

## Progress

| Step | Branch | Status | Tests | Test lines |
| --- | --- | --- | --- | --- |
| baseline | `main` 1221fe9 | — | 954 | 10,750 |
| 1 | `slim/schema-tuning` | merged bd24169 | 948 | 10,304 |
| 2 | `slim/primitive-tests` | merged 38b0265 | 947 | (not measured) |
| 3 | `slim/tui-tests` | merged 4553536 | 972 | 9,256 |
| 4 | `slim/schema-state` | merged ff186fc (simulator 1.4x slower, hashes identical) | 930 | 8,978 |
| 5 | lead | CLAUDE.md merged 6ad69bc; skill edits left uncommitted with the user's own | | |
| 6a | `slim/decree-tests` | merged c059f31 | 888 | 7,921 |
| 6b | `slim/village-tests` | merged c9f40f7 | 823 | 6,709 |

Final on `main` c9f40f7: 823 tests, 6,709 test lines (target was about 5,000), 6,093 source lines, 98.34% line coverage.
