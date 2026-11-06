import type { GameView } from "../core/view";

/**
 * Reports what changed on the desk during a frame: the flavor line of each entry that expired, then the
 * first line of each entry that arrived. An entry the player settled leaves without a notice.
 */
export function deskNotice(
  previous: GameView,
  next: GameView,
  expired: readonly string[],
): string | null {
  const known = new Set(previous.desk.map((entry) => entry.id));
  const arrived = next.desk
    .filter((entry) => !known.has(entry.id))
    .map((entry) => entry.label);
  const lines = [...expired, ...arrived];
  return lines.length === 0 ? null : lines.join(" ");
}
