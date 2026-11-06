import type { Resource } from "../core/realm";
import type { Tuning } from "../core/tuning";
import type { CrownDemandView, CrownView } from "../core/view";
import { plain } from "./decree-format";

function resolutionNotice(
  last: CrownDemandView,
  met: boolean,
  tuning: Tuning,
): string {
  const lines = tuning.crown.lines[last.resource as Resource];
  // A missed demand reports what was still owed in the last view before the deadline, since the
  // collection at the deadline is not part of any view.
  const amount = met ? last.amount : last.amount - last.delivered;
  return (met ? lines.met : lines.missed).replaceAll("{amount}", plain(amount));
}

function crossedLastSeason(
  before: CrownDemandView,
  after: CrownDemandView,
  tuning: Tuning,
): boolean {
  const season = tuning.economy.ticksPerSeason;
  return before.ticksLeft > season && after.ticksLeft <= season;
}

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
    return resolutionNotice(before, next.met > previous.met, tuning);
  }
  if (before === null && after !== null) return after.herald;
  if (
    before !== null &&
    after !== null &&
    crossedLastSeason(before, after, tuning)
  ) {
    return `One season left to deliver ${plain(after.amount - after.delivered)} ${after.resource} to the crown.`;
  }
  return null;
}
