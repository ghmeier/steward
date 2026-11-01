import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { defaultSaveDir } from "./paths";

const home = join("/home", "someone");

describe("defaultSaveDir", () => {
  test("uses STEWARD_SAVE_DIR on every platform", () => {
    const env = { STEWARD_SAVE_DIR: "/custom/saves", XDG_DATA_HOME: "/xdg" };

    for (const platform of ["linux", "darwin", "win32"] as const) {
      expect(defaultSaveDir(env, platform, home)).toBe("/custom/saves");
    }
  });

  test("uses Application Support on macOS", () => {
    expect(defaultSaveDir({}, "darwin", home)).toBe(
      join(home, "Library", "Application Support", "Steward"),
    );
  });

  test("uses APPDATA on Windows and falls back to AppData/Roaming without it", () => {
    expect(
      defaultSaveDir({ APPDATA: "C:/Users/x/AppData/Roaming" }, "win32", home),
    ).toBe(join("C:/Users/x/AppData/Roaming", "Steward"));
    expect(defaultSaveDir({}, "win32", home)).toBe(
      join(home, "AppData", "Roaming", "Steward"),
    );
  });

  test("uses XDG_DATA_HOME on Linux and falls back to ~/.local/share", () => {
    expect(defaultSaveDir({ XDG_DATA_HOME: "/xdg" }, "linux", home)).toBe(
      join("/xdg", "steward"),
    );
    expect(defaultSaveDir({}, "linux", home)).toBe(
      join(home, ".local", "share", "steward"),
    );
  });

  test("ignores an empty STEWARD_SAVE_DIR", () => {
    expect(defaultSaveDir({ STEWARD_SAVE_DIR: "" }, "linux", home)).toBe(
      join(home, ".local", "share", "steward"),
    );
  });
});
