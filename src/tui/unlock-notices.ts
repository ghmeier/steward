import { copy } from "../core/copy";
import type { Tuning } from "../core/tuning";
import {
  ARCHIVE_PANEL,
  CONJURING,
  COURT_PANEL,
  CROWN_PANEL,
  DECREES_PANEL,
  FORGING,
  GOVERNORS,
  type UnlockId,
} from "../core/unlocks";
import type { Notice } from "./notices";
import { keymap } from "./village-panels";

/** Unlocks that change what the player can do get a notice naming the key to press; the rest just say they were bought. */
const SPECIFIC_NOTICES: Partial<Record<UnlockId, () => string>> = {
  [ARCHIVE_PANEL]: () =>
    copy.notices.archiveOpens({ key: keymap.keyFor("archive") }),
  [COURT_PANEL]: () => copy.notices.courtOpens({ key: keymap.keyFor("court") }),
  [DECREES_PANEL]: () =>
    copy.notices.decreesOpen({ key: keymap.keyFor("decrees") }),
  [CROWN_PANEL]: () =>
    copy.notices.charterOpens({ key: keymap.keyFor("crown") }),
  [FORGING]: () =>
    copy.notices.forgingOpens({
      key: keymap.panelHintKey("crown", copy.keys.panelActions.forge),
    }),
  [CONJURING]: () =>
    copy.notices.conjuringOpens({ key: keymap.keyFor("ledger") }),
  [GOVERNORS]: () => copy.notices.governorsOpen,
};

function noticeFor(id: UnlockId, tuning: Tuning): string | null {
  const specific = SPECIFIC_NOTICES[id];
  if (specific !== undefined) return specific();
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
