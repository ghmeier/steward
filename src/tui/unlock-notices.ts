import { copy } from "../core/copy";
import type { Tuning } from "../core/tuning";
import { ARCHIVE_PANEL, CONJURING, type UnlockId } from "../core/unlocks";
import type { Notice } from "./notices";
import { keymap } from "./village-panels";

function noticeFor(id: UnlockId, tuning: Tuning): string | null {
  if (id === ARCHIVE_PANEL)
    return copy.notices.archiveOpens({ key: keymap.keyFor("archive") });
  if (id === CONJURING)
    return copy.notices.conjuringOpens({ key: keymap.keyFor("ledger") });
  const entry = tuning.archive.entries.find((candidate) => candidate.id === id);
  if (entry !== undefined) return copy.notices.bought({ label: entry.label });
  const play = tuning.archive.play.find((candidate) => candidate.id === id);
  return play === undefined
    ? null
    : copy.notices.unlocked({ label: play.label });
}

/**
 * Announces each unlock that appears between two views. A notice is a difference between views, so a
 * loaded save, whose first view has nothing before it, never replays old announcements.
 */
export const unlockNotice: Notice = (previous, next, { tuning }) => {
  const owned = new Set(previous.unlocks);
  const lines = next.unlocks
    .filter((id) => !owned.has(id))
    .map((id) => noticeFor(id, tuning))
    .filter((line) => line !== null);
  return lines.length === 0 ? null : lines.join(" ");
};
