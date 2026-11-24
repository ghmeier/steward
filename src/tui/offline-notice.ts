import { copy } from "../core/copy";
import type { OfflineSummary } from "../core/offline";
import { RESOURCES } from "../core/realm";
import type { Tuning } from "../core/tuning";
import { formatAmount, formatTicks } from "./format";

/** What the player was away for and what it earned, or null when no time was credited. */
export function offlineNotice(
  summary: OfflineSummary,
  tuning: Tuning,
): string | null {
  if (summary.compressedTicks === 0) return null;

  const away = formatTicks(summary.realTicks, tuning.stepMs);
  const gains = RESOURCES.filter((resource) => summary.gains[resource] > 0).map(
    (resource) => `${formatAmount(summary.gains[resource])} ${resource}`,
  );
  const report =
    gains.length === 0
      ? copy.notices.awayNothingGained({ away })
      : copy.notices.awayGained({ away, gains: gains.join(", ") });
  if (summary.fullStores.length === 0) return report;
  return `${report} ${copy.notices.awayStoresFull({ stores: new Intl.ListFormat("en").format(summary.fullStores) })}`;
}
