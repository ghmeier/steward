import { copy } from "../core/copy";
import type { IllusionView } from "../core/illusion";
import type { Tuning } from "../core/tuning";
import { formatTicksRoughly } from "./format";

/**
 * Warns once, on the frame the auditors set out. A notice is a difference between views, so a loaded
 * save whose auditors are already on the road never replays it.
 */
export function auditNotice(
  previous: IllusionView | null,
  next: IllusionView | null,
  tuning: Tuning,
): string | null {
  if (previous === null || next === null) return null;
  if (previous.auditOnTheRoad || !next.auditOnTheRoad) return null;
  if (next.auditInTicks === null)
    return copy.notices.auditorsOnTheRoadUnknownWait;
  const wait = formatTicksRoughly(next.auditInTicks, tuning.stepMs);
  return copy.notices.auditorsOnTheRoad({ wait });
}
