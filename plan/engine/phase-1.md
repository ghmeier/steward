---
title: "Steward: Phase 1 implementation plan"
status: completed
tags: [phase-1, engine]
created: 2026-10-28
updated: 2026-11-06
---
# Steward: Phase 1 implementation plan

Source: https://claude.ai/artifact/AUjJPyCE9q6kSya585Vtm1 (Garret Meier, 2026-10-25). This copy is the working reference for agents; the source doc wins if they disagree. Phase 1 implements phase 1 of the development plan (https://claude.ai/artifact/W1LESSbnonaotUx1qEu93J).

## Lead decisions (2026-10-28, confirmed by Garret the same day)

- **Tick rate**: 10 ticks per second (`stepMs: 100` in `data/tuning.json`). The plan's own estimates assume it, and it is one constant to change.
- **RNG**: named substreams (the plan's recommendation), xoshiro128**. Stream seeds come from hashing the posting seed with the stream name using a fixed integer hash (for example FNV-1a 32 over the name mixed with the seed, then splitmix32 to fill four words), never SHA or `Bun.hash`, so the core stays pure.
- **Platforms**: macOS arm64 and Linux x64. The spike is verified on macOS arm64 locally; Linux x64 is verified only by the CI workflow, since there is no Docker or remote here.
- **Absorbed additions**: measured only, not fixed, as the plan says.
- **Git**: worktrunk needs Git 2.43+, so Git 2.56 was installed with Homebrew (`/opt/homebrew/bin/git`); the system Git is 2.39.
- **State hash lives outside the core**: the canonical serializer is in `src/core/serialize.ts`, but SHA-256 runs in `src/save/hash.ts` via `Bun.CryptoHasher`, since the core may not touch `Bun`.
- **No remote / no `gh`** in this environment: CI is written (`.github/workflows/ci.yml`) but not yet run. Merges happen locally with `wt merge`.

## Scope and exit criteria

Phase 1 delivers a headless engine that steps a seeded save deterministically, saves and loads it losslessly, and is driven by a CLI runner. It ships no gameplay and no TUI.

In scope: the state model with career and posting layers, a fixed-step `tick`, the `apply` command path with a command log, a seeded RNG whose position is saved, the deterministic math rules and helpers, versioned atomic saves, the headless runner, and the test harness every later phase reuses.

Out of scope: rendering, decrees, content loading beyond tuning constants, offline catch-up, and save migration.

Phase 1 is done when all five of these pass in CI:

1. Same seed, same command log, 10,000 steps: identical state hash across two separate processes.
2. Save at step 5,000, load, continue to 10,000: identical hash to an uninterrupted run. This is the test that catches an unsaved RNG position or hidden state.
3. Load then save produces a byte-identical file.
4. A toy system that consumes the RNG and changes state every tick is running, so tests 1 and 2 actually exercise something.
5. The core imports nothing from the TUI, the file system, `Date` or `Math.random`, enforced by a lint rule rather than by convention.

## Day-zero spike

Prove the risky dependency works before writing engine code. If `@opentui/core` fails to install it changes the stack.

- Install `@opentui/core` on every target OS (at minimum macOS arm64 and Linux x64) and confirm it pulls prebuilt binaries without Zig.
- Render one box with text, read one keypress, exit cleanly, and confirm the terminal is restored.
- Pin the exact Bun and OpenTUI versions in `package.json` and a `.bun-version` or `engines` field.
- If any of this fails, stop and decide the fallback before phase 1 continues.

The spike code is thrown away; only the findings are kept, as a short note in the repo.

## Project layout and boundaries

One package with folders, not a monorepo.

| Folder | Holds | May import |
| --- | --- | --- |
| `src/core/` | State types, `tick`, `apply`, RNG, toy system, canonical hash | Nothing outside `src/core/` |
| `src/save/` | Serialize, validate, atomic write, load | `src/core/`, `node:fs`, `node:path` |
| `src/runner/` | Headless CLI | `src/core/`, `src/save/` |
| `src/tui/` | Empty until phase 2 | `src/core/`, `src/save/` |
| `data/` | `tuning.json` (tick rate, toy-system constants) | Not code |
| `test/` | Unit, determinism and golden tests | Anything |

TypeScript strict with `noUncheckedIndexedAccess`; Biome for lint and format. Biome's restricted globals and restricted imports for `src/core/` make `Date`, `Math.random`, `performance`, `setTimeout`, `process` and any `node:` import fail lint. A test scans `src/core/` imports as a backstop.

The core receives tuning values as an argument, never by reading `data/` itself.

## State model

Quantities are plain doubles, finite and below about 1.8e308. The core may use + − × ÷, comparisons, `Math.sqrt`, `Math.floor`, `Math.ceil`, `Math.round`, `Math.trunc`, `Math.abs`, `Math.min`, `Math.max`. It may not use `Math.pow`, `**`, `Math.log` and variants, `Math.exp`, trig functions, `Math.cbrt`, `Math.hypot`.

Integer powers go through `powInt(base, n)` (repeated squaring, multiplication only). Fractional powers and logs, if ever needed, get a hand-written helper with a fixed algorithm. The TUI may use any `Math` function for display.

JSON round-trips doubles losslessly except `Infinity` and `-0`. `clampFinite` caps values at a tuning maximum, `step` normalizes `-0` to `0`, and `validateState` rejects both.

```ts
type GameState = {
  schemaVersion: number;
  tick: number;                 // steps since career start
  career: CareerState;
  posting: PostingState;
};

type CareerState = {
  unlocks: Record<string, number>;      // id -> level; empty in phase 1
  savedDecrees: Record<string, unknown>; // placeholder
  followers: string[];                   // placeholder
  formerStaff: string[];                 // placeholder
};

type PostingState = {
  postingId: string;
  seed: number;          // uint32
  rng: Record<string, RngState>; // stream name -> 4 x uint32
  resources: Record<ResourceId, number>; // finite double, never -0
  // population, buildings, favor, illusionDebt added in later phases
};
```

Rules from day one:

- State is plain data: objects, arrays, finite numbers, strings, booleans. No `Map`, `Set`, class instances, `undefined`, `NaN`, `-0` or `Infinity`.
- Iterated collections are keyed records iterated in sorted key order, or arrays. Never rely on insertion order.
- Every entity id is a stable string, not an array index.
- `validateState` checks these rules and runs after every tick in tests and debug builds.

Placeholders are typed loosely on purpose; phases 3 and 5 own them.

## Seeded RNG

xoshiro128** (or sfc32) with four uint32 words, hand-written, using only `Math.imul`, shifts and `>>> 0`. No PCG32/xoshiro256 (need BigInt).

Named substreams: each system draws from its own stream, seeded by hashing the posting seed with the system name; all stream states are saved.

API (integer draws only):

- `nextU32(stream)` raw output.
- `intBelow(stream, n)` rejection sampling, no modulo bias.
- `chance(stream, perMille)` integer probabilities.

No `nextFloat`. Test against published reference outputs for a known seed, plus a property test that save/restore mid-sequence continues exactly.

## Tick, commands and the clock driver

Commands are queued and applied at the start of the next tick.

```ts
function step(state: GameState, commands: Command[], tuning: Tuning): void;
// 1. state.tick += 1
// 2. for each command in order: apply(state, command)
// 3. run systems in a fixed, listed order
// 4. (tests/debug) validateState(state)

function apply(state: GameState, command: Command): CommandResult;
```

`step` mutates in place. Tests clone with `structuredClone`. Commands are a discriminated union on `type` with plain-data fields. `apply` returns `{ ok: true }` or `{ ok: false, reason }`; rejected commands change nothing. Phase 1 commands: `noop` and `setToyRate`.

The command log is a list of `{ tick, command }`; the runner feeds each entry into the `step` for its tick.

`clock.ts` (outside the core, shared by TUI and runner):

- Accumulate elapsed wall time, run `floor(accumulated / stepMs)` steps, carry the remainder.
- Cap steps per frame (for example 50).
- Time beyond the cap is dropped in phase 1 and routed to offline catch-up in phase 10. Note this explicitly.

Toy system: each tick one resource grows by a tuning rate, and with a small per-mille chance from its own stream a random amount is removed.

## Save and load

One canonical serializer (sorted keys, fixed indentation) produces both the save file and the state hash.

```json
{
  "schemaVersion": 1,
  "savedAt": "2026-10-26T07:00:00.000Z",
  "contentHash": "sha256 of data/ files",
  "state": { }
}
```

`savedAt` and `contentHash` are not part of the state hash.

Writing:

1. Serialize to a string and validate it first.
2. Write `save.json.tmp` in the same directory, `fsync` it.
3. Rename current `save.json` to `save.json.bak`.
4. Rename temp to `save.json`, then `fsync` the directory on POSIX.

Use `node:fs` (not `Bun.write`). Retry rename on Windows `EPERM` a few times.

Loading parses, checks `schemaVersion`, runs `validateState`. A version mismatch is refused and the file renamed to `save.v<old>.json`, never overwritten.

Save location: `$XDG_DATA_HOME/steward` (Linux), `~/Library/Application Support/Steward` (macOS), `%APPDATA%\Steward` (Windows), overridable with `STEWARD_SAVE_DIR`.

Phase 1 builds and tests `saveGame` and `loadGame` only. Note for phase 2: in raw mode Ctrl-C arrives as a keypress, not `SIGINT`.

## Headless runner

```sh
bun run sim --seed 42 --steps 10000            # new game, print final hash
bun run sim --load save.json --steps 5000      # continue a save
bun run sim --seed 42 --steps 10000 \
  --commands log.json --out final.json          # replay a command log, write the save
bun run sim --seed 42 --steps 10000 --trace 1000 # print hash and resources every 1000 steps
```

One JSON line per trace point plus a final summary line. Non-zero exit on any validation failure, with the failing tick in the message. Reserve `--strategy <file>` (phase 3) but don't build it.

## Tests

All under `bun test`; CI on macOS and Linux. SHA-256 via `Bun.CryptoHasher`, not `Bun.hash`.

| Test | Checks | Catches |
| --- | --- | --- |
| RNG reference | Known seed matches published outputs | Wrong generator |
| RNG resume | Save/restore mid-sequence continues exactly | Lost RNG position |
| Two-process determinism | Two `bun run sim` processes, same seed and log, same hash | Hidden global state, iteration order |
| Split-run equivalence | 0→5,000, save, load, 5,000→10,000 equals 0→10,000 | Unsaved state |
| Round trip | Load then save is byte-identical, ignoring `savedAt` | Lossy serialization |
| Replay | A command log reproduces the recorded final hash | Commands at wrong time |
| State validity | `validateState` passes after every tick | Floats, `undefined`, `NaN` |
| Atomic write | Kill between temp write and rename; old save still loads | Torn writes |
| Core boundary | `src/core/` has no forbidden imports, globals, banned Math or `**` | Core erosion |
| Version refusal | Old-version save refused and preserved | Silent career loss |

Exactly one golden test (seed 42, 10,000 steps), regenerated with `bun run golden:update`; the commit message must say why it changed.

## Task order

After step 2, steps 3, 4 and 10 are independent and parallel; the rest run in order.

1. Spike OpenTUI install; record findings.
2. Repo setup: Bun, strict TS, Biome with core restrictions, `bun test`, CI on macOS and Linux.
3. RNG with substreams, reference and resume tests.
4. Math helpers: `powInt`, `add` with absorbed-addition logging, `clampFinite`, `-0` normalization, scan test for banned `Math` and `**`.
5. State types, `createNewGame(seed, tuning)`, `validateState`, canonical serializer and hash.
6. `step`, `apply`, command union, toy system, `tuning.json`.
7. Save and load: atomic write, `.bak`, version refusal, save location.
8. Runner CLI with `--seed`, `--load`, `--steps`, `--commands`, `--out`, `--trace`, and a summary of absorbed additions per resource.
9. Determinism suite: two-process, split-run, round trip, replay, golden.
10. `clock.ts` accumulator with step cap, tested against a fake clock.

## Risks

- **Banned functions creep in.** Biome can't ban `**`; the source-scan test is the real guard. Its failure message names `powInt`.
- **Large plus small is lost.** Every addition goes through `add(state, resource, delta)`, which in debug/runner builds records nonzero deltas that leave the value unchanged; the runner reports them per resource with first tick. The scan test flags direct `+=` on resource fields.
- **Ceiling is a design commitment.** `clampFinite` makes overflow a visible cap.
- 10,000 steps may be too few (nightly 1,000,000 later). In-place mutation needs the phase 2 view to copy. `clock.ts` could wait until phase 2.

## Progress

| Step | Branch | Status |
| --- | --- | --- |
| 1 spike | lead (main) | done: macOS arm64 verified, see `docs/spike-opentui.md` |
| 2 setup | lead (main) | done: commit 23d7840 |
| 3 RNG | `rng` | merged 03b756e; reference outputs cross-checked against an independent Python implementation |
| 4 math | `math` | merged af09178; powInt is compared to a sequential loop only where bits are exact (squaring rounds differently, which is fine) |
| 10 clock | `clock` | merged f11776c |
| 5 state, validate, serializer | `state` | merged 1463e95 |
| 6 step, apply, toy | `step` | merged 40bc08f |
| 7 save, tuning loader, contentHash | `save` | merged 9b8a448 |
| 8–9 runner, determinism | `runner` | merged 012bdd6; a planted hidden-RNG bug fails the split-run and golden tests |
