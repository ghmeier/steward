import { copy } from "../core/copy";
import { formatTicksRoughly } from "./format";
import type { Notice } from "./notices";

/**
 * Warns once, on the frame the auditors set out. A notice is a difference between views, so a loaded
 * save whose auditors are already on the road never replays it.
 */
export const auditNotice: Notice = (previous, next, { tuning }) => {
  const [before, after] = [previous.illusion, next.illusion];
  if (before === null || after === null) return null;
  if (before.auditOnTheRoad || !after.auditOnTheRoad) return null;
  if (after.auditInTicks === null)
    return copy.notices.auditorsOnTheRoadUnknownWait;
  const wait = formatTicksRoughly(after.auditInTicks, tuning.stepMs);
  return copy.notices.auditorsOnTheRoad({ wait });
};
