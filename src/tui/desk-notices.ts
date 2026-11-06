import type { GameView } from "../core/view";

/**
 * Reports what changed on the desk between two views: the flavor line of an entry that expired,
 * then the first line of each entry that arrived. An entry the player settled leaves without a notice.
 */
export function deskNotice(previous: GameView, next: GameView): string | null {
  const known = new Set(previous.desk.map((entry) => entry.id));
  const lines: string[] = [];
  if (next.deskExpiry.id !== previous.deskExpiry.id) {
    lines.push(next.deskExpiry.line);
  }
  for (const entry of next.desk) {
    if (!known.has(entry.id)) lines.push(entry.label);
  }
  return lines.length === 0 ? null : lines.join(" ");
}
