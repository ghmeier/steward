import { copy } from "../core/copy";
import type { FormerGovernorView } from "../core/view";
import { formatAmount } from "./format";
import type { Notice } from "./notices";

function departureLine(departure: FormerGovernorView): string {
  const { name, reason, handedOver } = departure;
  const departed = {
    retired: copy.notices.governorRetired,
    died: copy.notices.governorDied,
    dismissed: copy.notices.governorDismissed,
  }[reason]({ name });
  if (handedOver <= 0) return departed;
  return `${departed} ${copy.notices.governorHandedOver({ coin: formatAmount(handedOver) })}`;
}

/**
 * Reports each governor who left between two views, with any hoard they handed over. The list of former
 * governors only grows, so a notice is the difference between views and a loaded save, whose first view
 * has nothing before it, never replays one.
 */
export const governorNotice: Notice = (previous, next) => {
  const departures = next.formerGovernors.slice(
    previous.formerGovernors.length,
  );
  return departures.length === 0
    ? null
    : departures.map(departureLine).join(" ");
};
