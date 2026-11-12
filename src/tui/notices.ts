import type { Tuning } from "../core/tuning";
import type { GameView } from "../core/view";
import { auditNotice } from "./audit-notices";
import { crownNotice } from "./crown-notices";
import { deskNotice } from "./desk-notices";
import { governorNotice } from "./governor-notices";
import { promotionNotice } from "./promotion-notice";
import { starvationNotice } from "./starvation-notice";
import { unlockNotice } from "./unlock-notices";

/**
 * Describes what changed between two views as a line for the message bar, or null when nothing worth
 * saying did. Every notice takes the same inputs so the frame loop can run them without knowing which is which.
 */
export type Notice = (
  previous: GameView,
  next: GameView,
  frame: { tuning: Tuning; expired: readonly string[] },
) => string | null;

/** The order is the priority: when several notices speak in one frame, the last one is shown. */
export const notices: readonly Notice[] = [
  starvationNotice,
  deskNotice,
  crownNotice,
  auditNotice,
  governorNotice,
  unlockNotice,
  promotionNotice,
];
