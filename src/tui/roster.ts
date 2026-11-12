import { copy } from "../core/copy";
import type { GovernorView } from "../core/governors";
import type { GameView } from "../core/view";
import { rowWindow } from "./cursor";
import { formatAmount } from "./format";
import { wrapPhrases } from "./wrap";

/** The rows the Peasants panel can select: governors first, then peasants. */
export class Roster {
  constructor(private view: GameView) {}

  get selectable(): { id: number }[] {
    return [...this.view.governors, ...this.view.delegates];
  }

  private static outputPhrase({
    resource,
    truth,
    reportedPerSecond,
  }: GovernorView): string {
    if (resource === null) return copy.village.governorIdle;
    if (truth === null) {
      return copy.village.governorReports({
        rate: formatAmount(reportedPerSecond),
        resource,
      });
    }
    const real = formatAmount(truth.realPerSecond);
    return truth.gapPerSecond > 0
      ? copy.village.governorBringsIn({
          real,
          resource,
          gap: formatAmount(truth.gapPerSecond),
        })
      : copy.village.governorHonest({ real, resource });
  }

  private static governorLines(
    governor: GovernorView,
    marker: string,
    width: number,
  ): string[] {
    return wrapPhrases(
      [
        `${marker} ${governor.name}  ${governor.job}`,
        copy.village.governorVillage({ village: governor.village }),
        copy.village.governorSeasonsLeft({ seasons: governor.seasonsLeft }),
        copy.governors.traitRowList({ traits: governor.traits }),
        Roster.outputPhrase(governor),
      ],
      width,
      2,
    );
  }

  /**
   * The panel's lines and the window of them to draw. Governors sit under their own heading and the
   * peasants under another, but only when there are governors, so a village without them reads as before.
   * The window follows the selected row's first line.
   */
  render(
    selectedId: number | null,
    { width, height }: { width: number; height: number },
  ): string[] {
    const { governors, delegates } = this.view;
    const marker = (id: number) => (id === selectedId ? ">" : " ");
    const lines: string[] = [];
    let selectedLine = 0;
    const mark = (id: number) => {
      if (id === selectedId) selectedLine = lines.length;
    };
    if (governors.length > 0) lines.push(copy.village.governorsHeading);
    for (const governor of governors) {
      mark(governor.id);
      lines.push(...Roster.governorLines(governor, marker(governor.id), width));
    }
    if (governors.length > 0) lines.push(copy.village.peasantsHeading);
    for (const delegate of delegates) {
      mark(delegate.id);
      const grudge = delegate.grudgeTicks > 0 ? ` ${copy.village.grudge}` : "";
      lines.push(
        `${marker(delegate.id)} ${delegate.name}  ${delegate.job}${grudge}`,
      );
    }
    const { start, end } = rowWindow(lines.length, selectedLine, height);
    const shown = lines.slice(start, end);
    if (start > 0)
      shown.unshift(copy.village.moreAbove({ count: String(start) }));
    if (end < lines.length) {
      shown.push(copy.village.moreBelow({ count: String(lines.length - end) }));
    }
    return shown;
  }
}
