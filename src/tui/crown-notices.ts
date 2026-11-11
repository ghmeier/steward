import { copy } from "../core/copy";
import type { Resource } from "../core/realm";
import type { Tuning } from "../core/tuning";
import type { CrownView } from "../core/view";
import { plain } from "./decree-format";

/**
 * Reports what the crown did between two views: a demand resolved, a new one made, or one season left
 * to meet the open one. A notice is a difference between views, so a loaded save, whose first view
 * has nothing before it, never replays one.
 */
export function crownNotice(
  previous: CrownView | null,
  next: CrownView | null,
  tuning: Tuning,
): string | null {
  if (previous === null || next === null) return null;
  const before = previous.demand;
  const after = next.demand;
  if (before !== null && after === null) {
    const lines = tuning.crown.lines[before.resource as Resource];
    const line = next.met > previous.met ? lines.met : lines.missed;
    return line.replaceAll("{amount}", plain(before.amount));
  }
  if (after === null) return null;
  if (before === null) return after.herald;
  const season = tuning.economy.ticksPerSeason;
  if (before.ticksLeft > season && after.ticksLeft <= season) {
    return copy.notices.oneSeasonLeft({
      amount: plain(after.amount - after.delivered),
      resource: after.resource,
    });
  }
  return null;
}
