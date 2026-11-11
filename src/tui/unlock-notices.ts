import type { Tuning } from "../core/tuning";
import { ARCHIVE_PANEL, CONJURING, type UnlockId } from "../core/unlocks";

export const ARCHIVE_OPENS = "The Archive opens. Press a to buy.";

export const CONJURING_OPENS =
  "You have learned conjuring. Press l to focus the Ledger, which will believe anything you tell it.";

function noticeFor(id: UnlockId, tuning: Tuning): string | null {
  if (id === ARCHIVE_PANEL) return ARCHIVE_OPENS;
  if (id === CONJURING) return CONJURING_OPENS;
  const entry = tuning.archive.entries.find((candidate) => candidate.id === id);
  if (entry !== undefined) return `Bought ${entry.label}.`;
  const play = tuning.archive.play.find((candidate) => candidate.id === id);
  return play === undefined ? null : `${play.label} unlocked.`;
}

/**
 * Announces each owned unlock once. `known` holds the ids already seen and is updated in place; it must
 * start from the unlocks owned when a game begins so a loaded save never replays old announcements.
 */
export function announceNewUnlocks(
  known: Set<UnlockId>,
  owned: readonly UnlockId[],
  tuning: Tuning,
): string | null {
  const notices: string[] = [];
  for (const id of owned) {
    if (known.has(id)) continue;
    known.add(id);
    const notice = noticeFor(id, tuning);
    if (notice !== null) notices.push(notice);
  }
  return notices.length === 0 ? null : notices.join(" ");
}
