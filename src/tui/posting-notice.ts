import { copy } from "../core/copy";
import type { Notice } from "./notices";
import { keymap } from "./village-panels";

/** Announces the frame the posting first becomes endable. A loaded save that is already endable never replays it. */
export const postingMilestoneNotice: Notice = (previous, next) =>
  !previous.prestige.canEnd && next.prestige.canEnd
    ? copy.notices.postingMayEnd({
        key: keymap.panelHintKey("crown", copy.keys.panelActions.endPosting),
        met: next.prestige.demandsMet,
      })
    : null;
