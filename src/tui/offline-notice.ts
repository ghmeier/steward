import { formatGains } from "../core/amount";
import { copy } from "../core/copy";
import type { OfflineSummary } from "../core/offline";
import type { Tuning } from "../core/tuning";
import { formatTicks } from "./format";

/** What the player was away for and what it earned, or null when no time was credited. */
export function offlineNotice(
  summary: OfflineSummary,
  tuning: Tuning,
): string | null {
  if (summary.compressedTicks === 0) return null;

  const away = formatTicks(summary.realTicks, tuning.stepMs);
  const gains = formatGains(summary.gains);
  const report =
    gains === null
      ? copy.notices.awayNothingGained({ away })
      : copy.notices.awayGained({ away, gains });
  if (summary.fullStores.length === 0) return report;
  return `${report} ${copy.notices.awayStoresFull({ stores: summary.fullStores })}`;
}
