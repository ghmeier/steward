import { copy } from "../core/copy";
import type { DeskEntryView, DeskOptionView } from "../core/desk";
import { formatTicks } from "./format";
import type { MenuContext, MenuItem, Screen, ScreenBuilder } from "./menu";

function amountText(resource: string, amount: number): string {
  const sign = amount < 0 ? "−" : "+";
  const magnitude = Math.abs(amount);
  // Rounding up keeps a cost from being understated, so the player is never told they can afford what they cannot.
  const text = Number.isInteger(magnitude)
    ? String(magnitude)
    : (Math.ceil(magnitude * 10) / 10).toFixed(1);
  return `${sign}${text} ${resource}`;
}

function costText(option: DeskOptionView): string {
  const parts = Object.entries(option.resources).map(([resource, amount]) =>
    amountText(resource, amount),
  );
  return parts.length === 0 ? copy.court.free : parts.join(", ");
}

function optionLabel(option: DeskOptionView): string {
  const notes = [
    ...(option.sulker === null
      ? []
      : [copy.court.sulks({ sulker: option.sulker })]),
    ...(option.newcomers === 0
      ? []
      : [copy.court.brings({ count: option.newcomers })]),
    ...(option.expiry ? [copy.court.defaultIfIgnored] : []),
  ];
  return [`${option.label}: ${costText(option)}`, ...notes].join(" ");
}

/** An entry with a deadline of its own says how long is left, the way the Crown panel does. */
export function courtEntryLabel(
  entry: DeskEntryView,
  tuning: MenuContext["tuning"],
): string {
  return entry.ticksLeft === null
    ? entry.label
    : copy.court.dueIn({
        wait: formatTicks(entry.ticksLeft, tuning.stepMs),
        label: entry.label,
      });
}

function entryScreen(entryId: number): ScreenBuilder {
  return (context: MenuContext): Screen => {
    const entry = context.view.desk.find(
      (candidate) => candidate.id === entryId,
    );
    if (entry === undefined) {
      return {
        kind: "list",
        title: copy.court.deskTitle,
        notes: [copy.court.noLongerOnDesk],
        items: [],
      };
    }
    return {
      kind: "list",
      title: copy.court.decideTitle,
      notes: [courtEntryLabel(entry, context.tuning)],
      items: entry.options.map(
        (option): MenuItem => ({
          label: optionLabel(option),
          disabled: !option.affordable,
          action: {
            kind: "command",
            command: {
              type: "settleDispute",
              dispute: entry.id,
              option: option.id,
            },
            after: "pop",
          },
        }),
      ),
    };
  };
}

export const courtMenu: ScreenBuilder = (context) => {
  const entries = context.view.desk;
  return {
    kind: "list",
    title: copy.court.deskTitle,
    notes: entries.length === 0 ? [copy.court.nothingWaits] : [],
    items: entries.map((entry) => ({
      label: courtEntryLabel(entry, context.tuning),
      action: { kind: "push", screen: entryScreen(entry.id) },
    })),
  };
};
