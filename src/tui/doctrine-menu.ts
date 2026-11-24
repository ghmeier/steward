import { copy } from "../core/copy";
import { describeEffects } from "./effects";
import type { ScreenBuilder } from "./menu";

const joined = (lines: string[]): string =>
  lines.length === 0 ? copy.menus.doctrineNone : lines.join(", ");

/** The second screen of ending a posting: the player commits to one doctrine, and the choice carries to the name prompt. */
export const doctrineMenu: ScreenBuilder = ({ tuning }) => {
  const { entries } = tuning.doctrines;
  return {
    kind: "list",
    title: copy.menus.doctrineTitle,
    notes: [
      copy.menus.doctrineIntro,
      "",
      ...entries.flatMap((entry) => {
        const { bonus, cost } = describeEffects(entry.effects);
        return [
          copy.menus.doctrineSummary({
            label: entry.label,
            bonus: joined(bonus),
            cost: joined(cost),
            rule: entry.rule.label,
            description: entry.rule.description,
          }),
          "",
        ];
      }),
    ],
    items: entries.map((entry) => ({
      label: entry.label,
      action: {
        kind: "app",
        request: { kind: "endPosting", doctrine: entry.id },
      },
    })),
  };
};
