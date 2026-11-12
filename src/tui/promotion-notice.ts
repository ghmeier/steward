import { copy } from "../core/copy";
import type { Notice } from "./notices";

/** Announces the frame the crown promotes the player. A loaded save that is already promoted never replays it. */
export const promotionNotice: Notice = (previous, next) =>
  previous.promotion.promotedAt === 0 && next.promotion.promotedAt > 0
    ? copy.notices.promoted
    : null;
