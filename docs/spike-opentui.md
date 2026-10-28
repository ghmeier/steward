# OpenTUI install spike

Result on 2026-10-28: `@opentui/core` 0.7.0 installs and runs under Bun 1.3.14 without Zig. Phase 1 continues on the planned stack.

## What was checked

| Check                                   | macOS arm64                                                                             | Linux x64                                                                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Install pulls a prebuilt binary, no Zig | Yes: `@opentui/core-darwin-arm64` ships `libopentui.dylib`; install took under 1 second | Not run locally. `@opentui/core-linux-x64@0.7.0` is published on npm (5.1 MB unpacked). CI installs it on `ubuntu-latest`. |
| Render a bordered box with text         | Yes                                                                                     | Not run                                                                                                                    |
| Read one keypress                       | Yes                                                                                     | Not run                                                                                                                    |
| Exit restores the terminal              | Yes: output leaves the alternate screen (`ESC[?1049l`) and shows the cursor again       | Not run                                                                                                                    |

The render, keypress and restore checks ran the spike under a pseudo-terminal driven by a script, so they were observed through the escape sequences rather than by eye.

## Findings to carry forward

- OpenTUI 0.7.0 requires Bun 1.3.14 or later. Both versions are pinned exactly in `package.json` (`engines.bun`) and `.bun-version`.
- Platform binaries arrive as optional dependencies (`@opentui/core-<os>-<arch>`, including musl and Windows variants), so a lockfile from one machine installs on the other.
- `createCliRenderer({ exitOnCtrlC })`: when the TUI handles Ctrl-C itself (phase 2 must, to save first), pass `exitOnCtrlC: false`, then call `renderer.destroy()` and `await renderer.closed` before `process.exit()` on every shutdown path.
- Linux x64 still needs an eye-test of render and keypress once a Linux machine or CI runner is available.
