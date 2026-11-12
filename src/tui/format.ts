import { formatAmount, formatMagnitude } from "../core/amount";
import { copy } from "../core/copy";

export { formatAmount };

export function formatRate(perSecond: number): string {
  const body = formatMagnitude(Math.abs(perSecond));
  if (body === "0.0") return "0.0/s";
  return `${perSecond > 0 ? "+" : "-"}${body}/s`;
}

/** Three significant digits, so a small figure such as 0.04 is not rounded away to 0.0. */
export function plain(value: number): string {
  return String(Number(value.toPrecision(3)));
}

export function formatGameTime(seconds: number): string {
  const total = Math.floor(seconds);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  if (days > 0) return `${days}d ${two(hours)}h ${two(minutes)}m`;
  if (hours > 0) return `${hours}h ${two(minutes)}m ${two(secs)}s`;
  if (minutes > 0) return `${minutes}m ${two(secs)}s`;
  return `${secs}s`;
}

export function formatTicks(ticks: number, stepMs: number): string {
  return formatGameTime((ticks * stepMs) / 1000);
}

/** Whole minutes once past one, since a countdown to the second would flicker for something not yet due. */
export function formatTicksRoughly(ticks: number, stepMs: number): string {
  const seconds = (ticks * stepMs) / 1000;
  return seconds < 60
    ? formatGameTime(seconds)
    : `${Math.round(seconds / 60)}m`;
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A price such as "40 wood · 10 ore", one part per resource it charges. */
export function formatCost(
  parts: readonly { resource: string; amount: number }[],
): string {
  return parts
    .map(({ resource, amount }) => `${plain(amount)} ${resource}`)
    .join(copy.village.costJoin);
}
