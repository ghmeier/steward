import type { DeskEntryView, DeskOptionView } from "../core/view";
import type { MenuContext, MenuItem, Screen, ScreenBuilder } from "./menu";

function amountText(resource: string, amount: number): string {
  const sign = amount < 0 ? "−" : "+";
  return `${sign}${String(Math.abs(amount))} ${resource}`;
}

function costText(option: DeskOptionView): string {
  const parts = Object.entries(option.resources).map(([resource, amount]) =>
    amountText(resource, amount),
  );
  return parts.length === 0 ? "free" : parts.join(", ");
}

function optionLabel(entry: DeskEntryView, option: DeskOptionView): string {
  const party = option.grudge;
  const sulk =
    party === "none" || entry.parties === null
      ? ""
      : ` (${entry.parties[party === "first" ? 0 : 1]} will sulk for a season)`;
  const fallback = option.expiry ? " (the default if ignored)" : "";
  return `${option.label}: ${costText(option)}${sulk}${fallback}`;
}

function entryScreen(entryId: number): ScreenBuilder {
  return (context: MenuContext): Screen => {
    const entry = context.view.desk.find(
      (candidate) => candidate.id === entryId,
    );
    if (entry === undefined) {
      return {
        kind: "list",
        title: "The desk",
        notes: ["This matter is no longer on the desk."],
        items: [],
      };
    }
    return {
      kind: "list",
      title: "Decide",
      notes: [entry.label],
      items: entry.options.map(
        (option): MenuItem => ({
          label: optionLabel(entry, option),
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
    title: "The desk",
    notes: entries.length === 0 ? ["Nothing waits on the desk."] : [],
    items: entries.map((entry) => ({
      label: entry.label,
      action: { kind: "push", screen: entryScreen(entry.id) },
    })),
  };
};
