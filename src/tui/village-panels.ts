import type { Command } from "../core/commands";
import { PETITIONS } from "../core/decree";
import type { ArchiveEntryView, GameView } from "../core/view";
import { courtMenu } from "./court-menu";
import { type Cursor, moveCursor, reconcileCursor, rowWindow } from "./cursor";
import { formatRule, plain } from "./decree-format";
import { formatAmount, formatGameTime, formatRate } from "./format";
import {
  type FocusId,
  type KeyPress,
  keyName,
  panelHintsText,
  peasantActionForKey,
} from "./keys";
import {
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

export interface VillagePanel {
  readonly id: FocusId;
  readonly name: string;
  /** Called when the panel gains focus, so it never shows state left over from an earlier visit. */
  enter(context: MenuContext): void;
  body(context: MenuContext, size: PanelSize, focused: boolean): string;
  /** `width` is the room on the border; a hint line that does not fit would be dropped by the renderer. */
  hints(context: MenuContext, width: number): string;
  /** Returns null for a key the panel does not own, so it falls through to the global keys. */
  key(key: KeyPress, context: MenuContext): PanelStep | null;
}

const UNFOCUS: PanelStep = { commands: [], requests: [{ kind: "unfocus" }] };
const EMPTY_VILLAGE = "The village is empty. Press n to found a new one.";
const DESK_CLEAR = "The desk is clear.";
const MENU_KEYS = new Set([
  "up",
  "down",
  "j",
  "k",
  "return",
  "enter",
  "escape",
]);

function isPlain(key: KeyPress): boolean {
  return !key.ctrl && !key.meta;
}

function isEscape(key: KeyPress): boolean {
  return isPlain(key) && key.name === "escape";
}

function step(
  commands: Command[] = [],
  requests: PanelRequest[] = [],
): PanelStep {
  return { commands, requests };
}

export function peasantLines(
  view: GameView,
  selectedId: number | null,
  height = Number.POSITIVE_INFINITY,
): string[] {
  const rows = view.delegates.map((delegate) => {
    const cursor = delegate.id === selectedId ? ">" : " ";
    const grudge = delegate.grudgeTicks > 0 ? " (grudge)" : "";
    return `${cursor} ${delegate.name}  ${delegate.job}${grudge}`;
  });
  const selected = view.delegates.findIndex(
    (delegate) => delegate.id === selectedId,
  );
  const { start, end } = rowWindow(rows.length, selected, height);
  const lines = rows.slice(start, end);
  if (start > 0) lines.unshift(`↑ ${start} more`);
  if (end < rows.length) lines.push(`↓ ${rows.length - end} more`);
  return lines;
}

export class PeasantsPanel implements VillagePanel {
  readonly id = "peasants";
  readonly name = "Peasants";
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
    return peasantLines(view, selectedId, size.height).join("\n");
  }

  hints(_context: MenuContext, width: number): string {
    return panelHintsText(this.id, width);
  }

  key(key: KeyPress, { view }: MenuContext): PanelStep | null {
    if (isEscape(key)) return UNFOCUS;
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
abstract class MenuPanel implements VillagePanel {
  abstract readonly id: FocusId;
  abstract readonly name: string;
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

  hints(context: MenuContext, width: number): string {
    if (this.menu === null) return "";
    const own = renderMenu(this.menu, context).hints;
    return own.length <= width ? own : panelHintsText(this.id, width);
  }

  key(key: KeyPress, context: MenuContext): PanelStep | null {
    if (this.menu === null || !isPlain(key) || !MENU_KEYS.has(key.name)) {
      return null;
    }
    const result = menuKey(this.menu, key, context);
    if (isEscape(key) && result.state === null) {
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
  readonly name = "Court";
  protected readonly root = courtMenu;

  protected unfocusedLines({ view }: MenuContext): string[] {
    return view.desk.length === 0
      ? [DESK_CLEAR]
      : view.desk.map((entry) => entry.label);
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
  readonly name = "Archive";
  protected readonly root = archiveScreen;

  // Every Archive screen is the one list, so the fixed hints say what enter does there.
  override hints(_context: MenuContext, width: number): string {
    return panelHintsText(this.id, width);
  }

  protected unfocusedLines({ view }: MenuContext): string[] {
    return view.archive.entries.map((entry) => `  ${archiveLabel(entry)}`);
  }
}

export class DecreesPanel implements VillagePanel {
  readonly id = "decrees";
  readonly name = "Decrees";
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
    const label = Math.max(...PETITIONS.map((petition) => petition.length));
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

  hints(_context: MenuContext, width: number): string {
    return panelHintsText(this.id, width);
  }

  key(key: KeyPress, { view }: MenuContext): PanelStep | null {
    if (!isPlain(key)) return null;
    const name = keyName(key);
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

/** The four focusable panels, built once per app so each keeps its own selection. */
export class Village {
  readonly peasants = new PeasantsPanel();
  readonly panels: readonly VillagePanel[] = [
    this.peasants,
    new ArchivePanel(),
    new CourtPanel(),
    new DecreesPanel(),
  ];

  panel(id: FocusId): VillagePanel {
    const found = this.panels.find((candidate) => candidate.id === id);
    if (found === undefined) throw new Error(`no panel ${id}`);
    return found;
  }
}

export function panelTitle(name: string): string {
  return `(${name.charAt(0)})${name.slice(1)}`;
}

function capitalize(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/** The read-only resources panel; it takes no focus, so it has no keys. */
export class LedgerPanel {
  readonly name = "Ledger";

  private resourceLines(view: GameView): string[] {
    const rows = view.ledger.map((line) => [
      capitalize(line.resource),
      formatAmount(line.amount),
      formatRate(line.ratePerSecond),
    ]);
    const widths = [0, 1, 2].map((column) =>
      Math.max(0, ...rows.map((row) => row[column]?.length ?? 0)),
    );
    return rows.map(
      ([name = "", amount = "", rate = ""]) =>
        `${name.padEnd(widths[0] ?? 0)} ${amount.padStart(widths[1] ?? 0)} ${rate.padStart(widths[2] ?? 0)}`,
    );
  }

  // The panel is a quarter of the screen, so these two lines are split in two instead of cut off.
  private promotionLines(view: GameView): string[] {
    const { target, promotedAt, promotedAtSeconds } = view.promotion;
    if (promotedAt > 0) {
      return ["Promoted to steward", `on ${formatGameTime(promotedAtSeconds)}`];
    }
    return ["Promotion", `${view.realm.population} / ${target} peasants`];
  }

  private nextPeasantLines(view: GameView): string[] {
    const { stored, needed, perSecond, full } = view.growth;
    if (full) return [];
    const progress = `${formatAmount(stored)} / ${plain(needed)} grain`;
    if (perSecond <= 0) return ["Next peasant", progress];
    const seconds = Math.ceil((needed - stored) / perSecond);
    return [`Next peasant (~${formatGameTime(seconds)})`, progress];
  }

  body(view: GameView, size: PanelSize): string {
    const { realm } = view;
    return [
      `Time ${formatGameTime(view.elapsedSeconds)}`,
      ...this.resourceLines(view),
      `Peasants ${realm.population} (${realm.labor.idle} idle)`,
      `Farm ${realm.labor.farm} Forest ${realm.labor.forest} Mine ${realm.labor.mine}`,
      `Season ${capitalize(realm.season)}`,
      ...this.promotionLines(view),
      ...this.nextPeasantLines(view),
    ]
      .flatMap((line) => wrapLine(line, size.width, 2))
      .join("\n");
  }
}
