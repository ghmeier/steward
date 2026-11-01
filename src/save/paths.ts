import { homedir } from "node:os";
import { join } from "node:path";

export function defaultSaveDir(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  const override = env.STEWARD_SAVE_DIR;
  if (override) return override;
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "Steward");
  }
  if (platform === "win32") {
    return join(env.APPDATA || join(home, "AppData", "Roaming"), "Steward");
  }
  return join(env.XDG_DATA_HOME || join(home, ".local", "share"), "steward");
}
