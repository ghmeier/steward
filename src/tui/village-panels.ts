import type { Command } from "../core/commands";
import { PETITIONS } from "../core/decree";
import type { Resource } from "../core/realm";
import type {
  ArchiveEntryView,
  CrownDemandView,
  CrownView,
  GameView,
} from "../core/view";
import { courtEntryLabel, courtMenu } from "./court-menu";
import { type Cursor, moveCursor, reconcileCursor, rowWindow } from "./cursor";
import { formatRule, plain } from "./decree-format";
import {
  capitalize,
  formatAmount,
  formatGameTime,
  formatRate,
  formatTicks,
  formatTicksRoughly,
} from "./format";
import {
  type FocusId,
  type KeyPress,
  peasantActionForKey,
  plainKeyName,
} from "./keys";
import {
  LIST_KEYS,
  type MenuContext,
  type MenuItem,
  type MenuState,
  menuKey,
  openMenu,
  renderMenu,
  type ScreenBuilder,
} from "./menu";
import { wrapLine } from "./wrap";

export type PanelSize = { width: number; height: number };

/** What a panel asks of the app that is not a game command, so none of it enters the command log. */
export type PanelRequest =
  | { kind: "unfocus" }
  | { kind: "openLine"; text: string }
  | { kind: "message"; text: string };

export type PanelStep = { commands: Command[]; requests: PanelRequest[] };

/** Marks the key that focuses a panel by wrapping its letter, as in "(L)edger". */
export function titleWithKey(name: string, key = name.charAt(0)): string {
  const at = name.toLowerCase().indexOf(key.toLowerCase());
  return `${name.slice(0, at)}(${name.charAt(at)})${name.slice(at + 1)}`;
}

export abstract class VillagePanel {
  abstract readonly id: FocusId;

  /** Whether the panel takes no room at all while locked, instead of showing a locked placeholder. */
  readonly hiddenWhileLocked: boolean = false;

  get name(): string {
    return capitalize(this.id);
  }

  /** The border title; a panel whose key is not its first letter overrides the letter it marks. */
  get title(): string {
    return titleWithKey(this.name);
  }

  /** Called when the panel gains focus, so it never shows state left over from an earlier visit. */
  abstract enter(context: MenuContext): void;
  abstract body(
    context: MenuContext,
    size: PanelSize,
    focused: boolean,
  ): string;
  /** Returns null for a key the panel does not own, so it falls through to the global keys. */
  abstract key(key: KeyPress, context: MenuContext): PanelStep | null;
}

const UNFOCUS: PanelStep = { commands: [], requests: [{ kind: "unfocus" }] };
const EMPTY_VILLAGE = "The village is empty. Press n to found a new one.";
const DESK_CLEAR = "The desk is clear.";

function step(
  commands: Command[] = [],
  requests: PanelRequest[] = [],
): PanelStep {
  return { commands, requests };
}

export class PeasantsPanel extends VillagePanel {
  readonly id = "peasants";
  private cursor: Cursor | null = null;

  /** Keeps the selection on the same peasant as the roster changes. */
  reconcile(view: GameView): void {
    this.cursor = reconcileCursor(view.delegates, this.cursor);
  }

  reset(view: GameView): void {
    this.cursor = reconcileCursor(view.delegates, null);
  }

  enter({ view }: MenuContext): void {
    this.reconcile(view);
  }

  body({ view }: MenuContext, size: PanelSize, focused: boolean): string {
    if (view.realm.population === 0) return EMPTY_VILLAGE;
    const selectedId = focused ? (this.cursor?.id ?? null) : null;
    const rows = view.delegates.map((delegate) => {
      const marker = delegate.id === selectedId ? ">" : " ";
      const grudge = delegate.grudgeTicks > 0 ? " (grudge)" : "";
      return `${marker} ${delegate.name}  ${delegate.job}${grudge}`;
    });
    const selected = view.delegates.findIndex(
      (delegate) => delegate.id === selectedId,
    );
    const { start, end } = rowWindow(rows.length, selected, size.height);
    const lines = rows.slice(start, end);
    if (start > 0) lines.unshift(`↑ ${start} more`);
    if (end < rows.length) lines.push(`↓ ${rows.length - end} more`);
    return lines.join("\n");
  }

  key(key: KeyPress, { view }: MenuContext): PanelStep | null {
    if (plainKeyName(key) === "escape") return UNFOCUS;
    const action = peasantActionForKey(key);
    if (action === null) return null;
    if (action.kind === "move") {
      this.cursor = moveCursor(view.delegates, this.cursor, action.delta);
      return step();
    }
    if (this.cursor === null) {
      return step([], [{ kind: "message", text: "No peasant is selected." }]);
    }
    return step([
      { type: "assignPeasant", peasant: this.cursor.id, job: action.job },
    ]);
  }
}

/** A panel whose focused view is a `menu.ts` screen stack rendered inside the panel. */
abstract class MenuPanel extends VillagePanel {
  protected abstract readonly root: ScreenBuilder;
  private menu: MenuState | null = null;

  enter(): void {
    this.menu = openMenu(this.root);
  }

  protected abstract unfocusedLines(context: MenuContext): string[];

  body(context: MenuContext, size: PanelSize, focused: boolean): string {
    const lines =
      focused && this.menu !== null
        ? renderMenu(this.menu, context).lines
        : this.unfocusedLines(context);
    // One column stays empty on the right because panels have no right padding.
    return lines
      .flatMap((line) => wrapLine(line, size.width - 1, 2))
      .join("\n");
  }

  key(key: KeyPress, context: MenuContext): PanelStep | null {
    const name = plainKeyName(key);
    if (this.menu === null || name === null || !LIST_KEYS.has(name)) {
      return null;
    }
    const result = menuKey(this.menu, key, context);
    if (name === "escape" && result.state === null) {
      this.menu = null;
      return UNFOCUS;
    }
    // A finished purchase or ruling empties the stack, but the panel stays focused on its list.
    this.menu = result.state ?? openMenu(this.root);
    return step(result.commands);
  }
}

export class CourtPanel extends MenuPanel {
  readonly id = "court";
  protected readonly root = courtMenu;

  protected unfocusedLines({ view, tuning }: MenuContext): string[] {
    return view.desk.length === 0
      ? [DESK_CLEAR]
      : view.desk.map((entry) => courtEntryLabel(entry, tuning));
  }
}

function archiveLabel(entry: ArchiveEntryView): string {
  return `${entry.label}  ${entry.owned ? "owned" : `${entry.cost} coin`}`;
}

const archiveScreen: ScreenBuilder = ({ view }) => ({
  kind: "list",
  title: "The Archive",
  items: view.archive.entries.map(
    (entry): MenuItem => ({
      label: archiveLabel(entry),
      detail: entry.description,
      action: {
        kind: "command",
        command: { type: "buyUnlock", id: entry.id },
        after: "pop",
      },
    }),
  ),
});

export class ArchivePanel extends MenuPanel {
  readonly id = "archive";
  protected readonly root = archiveScreen;

  protected unfocusedLines({ view }: MenuContext): string[] {
    return view.archive.entries.map((entry) => `  ${archiveLabel(entry)}`);
  }
}

export class DecreesPanel extends VillagePanel {
  readonly id = "decrees";
  private static readonly labelWidth = Math.max(
    ...PETITIONS.map((petition) => petition.length),
  );
  private selected = 0;

  enter(): void {
    this.selected = 0;
  }

  private get petition() {
    return PETITIONS[this.selected] ?? PETITIONS[0];
  }

  private static decreeFor(view: GameView, petition: string) {
    return view.decrees.find((decree) => decree.petition === petition);
  }

  body({ view }: MenuContext, size: PanelSize, focused: boolean): string {
    const label = DecreesPanel.labelWidth;
    return PETITIONS.flatMap((petition, index) => {
      const decree = DecreesPanel.decreeFor(view, petition);
      const text =
        decree === undefined
          ? "none"
          : [
              ...decree.rules.map(formatRule),
              `otherwise ${decree.otherwise}`,
            ].join("; ");
      const marker = focused && index === this.selected ? ">" : " ";
      const row = `${marker} ${petition.padEnd(label)}  ${text}`;
      return wrapLine(row, size.width - 1, label + 4);
    }).join("\n");
  }

  key(key: KeyPress, { view }: MenuContext): PanelStep | null {
    const name = plainKeyName(key);
    if (name === "escape") return UNFOCUS;
    if (name === "j" || name === "down") {
      this.selected = Math.min(PETITIONS.length - 1, this.selected + 1);
      return step();
    }
    if (name === "k" || name === "up") {
      this.selected = Math.max(0, this.selected - 1);
      return step();
    }
    if (name === "return" || name === "enter") {
      return step([], [{ kind: "openLine", text: `decree ${this.petition} ` }]);
    }
    if (name !== "x") return null;
    const decree = DecreesPanel.decreeFor(view, this.petition);
    if (decree === undefined) {
      return step(
        [],
        [{ kind: "message", text: `No ${this.petition} decree is in force.` }],
      );
    }
    return step([{ type: "repealDecree", id: decree.id }]);
  }
}

export class CrownPanel extends VillagePanel {
  readonly id = "crown";
  override readonly hiddenWhileLocked = true;

  override get title(): string {
    return titleWithKey(this.name, "r");
  }

  enter(): void {}

  private static demandLines(
    demand: CrownDemandView,
    tuning: MenuContext["tuning"],
  ): string[] {
    return [
      demand.herald,
      `${demand.resource} ${plain(demand.delivered)} / ${plain(demand.amount)}`,
      `due in ${formatTicks(demand.ticksLeft, tuning.stepMs)}`,
    ];
  }

  private static quietLines(
    crown: CrownView,
    tuning: MenuContext["tuning"],
  ): string[] {
    const wait = formatTicksRoughly(crown.nextDemandTicks ?? 0, tuning.stepMs);
    return [`The crown is quiet. Next demand in about ${wait}.`];
  }

  body({ view, tuning }: MenuContext, size: PanelSize): string {
    const { crown } = view;
    if (crown === null) return "";
    const lines = [
      ...(crown.demand === null
        ? CrownPanel.quietLines(crown, tuning)
        : CrownPanel.demandLines(crown.demand, tuning)),
      "",
      `Met ${crown.met} \u00b7 missed ${crown.missed}`,
    ];
    return lines
      .flatMap((line) => wrapLine(line, size.width - 1, 2))
      .join("\n");
  }

  key(key: KeyPress): PanelStep | null {
    const name = plainKeyName(key);
    if (name === "escape") return UNFOCUS;
    if (name === "return" || name === "enter")
      return step([{ type: "deliver" }]);
    if (name === "f") return step([{ type: "forge" }]);
    return null;
  }
}

export class LedgerPanel extends VillagePanel {
  readonly id = "ledger";
  private selected = 0;

  enter(): void {
    this.selected = 0;
  }

  private resourceLines(view: GameView, focused: boolean): string[] {
    const rows = view.ledger.map((line) => [
      capitalize(line.resource),
      formatAmount(line.amount),
      formatRate(line.ratePerSecond),
    ]);
    const widths = [0, 1, 2].map((column) =>
      Math.max(0, ...rows.map((row) => row[column]?.length ?? 0)),
    );
    return rows.flatMap(([name = "", amount = "", rate = ""], index) => {
      const marker = focused && index === this.selected ? "> " : "  ";
      const row = `${name.padEnd(widths[0] ?? 0)} ${amount.padStart(widths[1] ?? 0)} ${rate.padStart(widths[2] ?? 0)}`;
      const conjured = view.ledger[index]?.conjured ?? 0;
      return [
        `${focused ? marker : ""}${row}`,
        ...(conjured > 0
          ? [`${focused ? "  " : ""}  (${formatAmount(conjured)} conjured)`]
          : []),
      ];
    });
  }

  private booksLines(view: GameView): string[] {
    return view.illusion === null ? [] : [`Books: ${view.illusion.books}`];
  }

  /** One line when it fits the column, otherwise the label above its value, so neither is cut off. */
  private labelled(label: string, value: string, width: number): string[] {
    const line = `${label}  ${value}`;
    if (line.length <= width) return [line];
    return [label, ...wrapLine(`  ${value}`, width, 0)];
  }

  private promotionLines(view: GameView, width: number): string[] {
    const { target, promotedAt, promotedAtSeconds } = view.promotion;
    if (promotedAt > 0) {
      return wrapLine(
        `Promoted to steward on ${formatGameTime(promotedAtSeconds)}`,
        width,
        2,
      );
    }
    return this.labelled(
      "Promotion",
      `${view.realm.population} / ${target} peasants`,
      width,
    );
  }

  private nextPeasantLines(view: GameView, width: number): string[] {
    const { stored, needed, perSecond, full } = view.growth;
    if (full) return [];
    const progress = `${formatAmount(stored)} / ${plain(needed)} grain`;
    if (perSecond <= 0) return this.labelled("Next peasant", progress, width);
    const seconds = Math.ceil((needed - stored) / perSecond);
    return this.labelled(
      "Next peasant",
      `${progress}  (~${formatGameTime(seconds)})`,
      width,
    );
  }

  body({ view }: MenuContext, size: PanelSize, focused: boolean): string {
    const { realm } = view;
    const rest = [
      ...this.resourceLines(view, focused),
      ...this.booksLines(view),
      "",
      ...[
        `Peasants ${realm.population} (${realm.labor.idle} idle)`,
        `Farm ${realm.labor.farm} Forest ${realm.labor.forest} Mine ${realm.labor.mine}`,
        `Season ${capitalize(realm.season)}`,
      ].flatMap((line) => wrapLine(line, size.width, 2)),
      ...this.promotionLines(view, size.width),
      ...this.nextPeasantLines(view, size.width),
    ];
    // The clock is the least useful line, so a short panel gives it up before anything else.
    if (rest.length >= size.height) return rest.join("\n");
    return [`Time  ${formatGameTime(view.elapsedSeconds)}`, ...rest].join("\n");
  }

  key(key: KeyPress, { view, tuning }: MenuContext): PanelStep | null {
    const name = plainKeyName(key);
    if (name === "escape") return UNFOCUS;
    if (name === "j" || name === "down") {
      this.selected = Math.min(view.ledger.length - 1, this.selected + 1);
      return step();
    }
    if (name === "k" || name === "up") {
      this.selected = Math.max(0, this.selected - 1);
      return step();
    }
    const resource = view.ledger[this.selected]?.resource as Resource;
    if (name === "return" || name === "enter") {
      return step([{ type: "conjure", resource, amount: tuning.illusion.lot }]);
    }
    if (name === "b") return step([{ type: "back", resource }]);
    return null;
  }
}

/** The village's panels, built once per app so each focusable one keeps its own selection. */
export class Village {
  readonly peasants = new PeasantsPanel();
  readonly focusable: Readonly<Record<FocusId, VillagePanel>> = {
    ledger: new LedgerPanel(),
    peasants: this.peasants,
    archive: new ArchivePanel(),
    court: new CourtPanel(),
    decrees: new DecreesPanel(),
    crown: new CrownPanel(),
  };
}
