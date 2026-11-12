import type { Command } from "../core/commands";
import { copy } from "../core/copy";
import type { CrownDemandView, CrownView } from "../core/crown";
import { PETITIONS } from "../core/decree";
import { DebtFigure } from "../core/illusion";
import type { Resource } from "../core/realm";
import type { Tuning } from "../core/tuning";
import { ARCHIVE_PANEL, CONJURING, CROWN_PANEL } from "../core/unlocks";
import type { ArchiveEntryView, GameView } from "../core/view";
import { courtEntryLabel, courtMenu } from "./court-menu";
import { type Cursor, moveCursor, reconcileCursor, stepIndex } from "./cursor";
import { formatPolicy, formatRule, plain } from "./decree-format";
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
  Keymap,
  type KeyPress,
  type PanelKeys,
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
import { Roster } from "./roster";
import { wrapLine, wrapPhrases } from "./wrap";

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
  /** TypeScript has no abstract statics, so each subclass overrides this declaration with its own keys. */
  declare static readonly keys: PanelKeys;

  get keys(): PanelKeys {
    return (this.constructor as typeof VillagePanel).keys;
  }

  get id(): FocusId {
    return this.keys.id;
  }

  get name(): string {
    return capitalize(this.id);
  }

  get title(): string {
    return titleWithKey(this.name, this.keys.focusKey);
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

function step(
  commands: Command[] = [],
  requests: PanelRequest[] = [],
): PanelStep {
  return { commands, requests };
}

export class PeasantsPanel extends VillagePanel {
  static override readonly keys: PanelKeys = {
    id: "peasants",
    focusKey: "p",
    needs: undefined,
    focusLabel: copy.keys.hints.peasants,
    hints: [
      { keys: "j/k", label: copy.keys.panelActions.select },
      { keys: "f/w/m/i", label: copy.keys.panelActions.assign },
      { keys: "esc", label: copy.keys.panelActions.back },
    ],
  };
  private cursor: Cursor | null = null;

  /** Keeps the selection on the same peasant as the roster changes. */
  reconcile(view: GameView): void {
    this.cursor = reconcileCursor(new Roster(view).selectable, this.cursor);
  }

  reset(view: GameView): void {
    this.cursor = reconcileCursor(new Roster(view).selectable, null);
  }

  enter({ view }: MenuContext): void {
    this.reconcile(view);
  }

  body({ view }: MenuContext, size: PanelSize, focused: boolean): string {
    if (view.realm.population === 0) return copy.village.emptyVillage;
    const selectedId = focused ? (this.cursor?.id ?? null) : null;
    // One column stays empty on the right because panels have no right padding.
    return new Roster(view)
      .render(selectedId, { width: size.width - 1, height: size.height })
      .join("\n");
  }

  key(key: KeyPress, { view }: MenuContext): PanelStep | null {
    if (plainKeyName(key) === "escape") return UNFOCUS;
    const action = peasantActionForKey(key);
    if (action === null) return null;
    if (action.kind === "move") {
      this.cursor = moveCursor(
        new Roster(view).selectable,
        this.cursor,
        action.delta,
      );
      return step();
    }
    if (this.cursor === null) {
      return step(
        [],
        [{ kind: "message", text: copy.village.noPeasantSelected }],
      );
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
  static override readonly keys: PanelKeys = {
    id: "court",
    focusKey: "c",
    needs: undefined,
    focusLabel: copy.keys.hints.court,
    hints: [
      { keys: "j/k", label: copy.keys.panelActions.select },
      { keys: "enter", label: copy.keys.panelActions.choose },
      { keys: "esc", label: copy.keys.panelActions.back },
    ],
  };
  protected readonly root = courtMenu;

  protected unfocusedLines({ view, tuning }: MenuContext): string[] {
    return view.desk.length === 0
      ? [copy.court.deskClear]
      : view.desk.map((entry) => courtEntryLabel(entry, tuning));
  }
}

function archiveLabel(entry: ArchiveEntryView): string {
  const status = entry.owned
    ? copy.village.archiveOwned
    : copy.village.archiveCost({ cost: String(entry.cost) });
  return `${entry.label}  ${status}`;
}

const archiveScreen: ScreenBuilder = ({ view }) => ({
  kind: "list",
  title: copy.village.archiveTitle,
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
  static override readonly keys: PanelKeys = {
    id: "archive",
    focusKey: "a",
    needs: ARCHIVE_PANEL,
    focusLabel: copy.keys.hints.archive,
    hints: [
      { keys: "j/k", label: copy.keys.panelActions.select },
      { keys: "enter", label: copy.keys.panelActions.buy },
      { keys: "esc", label: copy.keys.panelActions.back },
    ],
  };
  protected readonly root = archiveScreen;

  protected unfocusedLines({ view }: MenuContext): string[] {
    return view.archive.entries.map((entry) => `  ${archiveLabel(entry)}`);
  }
}

export class DecreesPanel extends VillagePanel {
  static override readonly keys: PanelKeys = {
    id: "decrees",
    focusKey: "d",
    needs: undefined,
    focusLabel: copy.keys.hints.decrees,
    hints: [
      { keys: "j/k", label: copy.keys.panelActions.select },
      { keys: "enter", label: copy.keys.panelActions.write },
      { keys: "x", label: copy.keys.panelActions.repeal },
      { keys: "esc", label: copy.keys.panelActions.back },
    ],
  };
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
          ? copy.decrees.none
          : [
              ...decree.rules.map(formatRule),
              `otherwise ${formatPolicy(decree.otherwise)}`,
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
        [
          {
            kind: "message",
            text: copy.village.noDecreeInForce({ petition: this.petition }),
          },
        ],
      );
    }
    return step([{ type: "repealDecree", id: decree.id }]);
  }
}

export class CrownPanel extends VillagePanel {
  static override readonly keys: PanelKeys = {
    id: "crown",
    focusKey: "r",
    needs: CROWN_PANEL,
    focusLabel: copy.keys.hints.crown,
    hints: [
      { keys: "enter", label: copy.keys.panelActions.deliver },
      { keys: "f", label: copy.keys.panelActions.forge },
      { keys: "esc", label: copy.keys.panelActions.back },
    ],
  };

  enter(): void {}

  private static demandLines(
    demand: CrownDemandView,
    tuning: MenuContext["tuning"],
  ): string[] {
    return [
      demand.herald,
      copy.village.crownProgress({
        resource: demand.resource,
        delivered: plain(demand.delivered),
        amount: plain(demand.amount),
      }),
      copy.village.crownDueIn({
        wait: formatTicks(demand.ticksLeft, tuning.stepMs),
      }),
    ];
  }

  private static quietLines(
    crown: CrownView,
    tuning: MenuContext["tuning"],
  ): string[] {
    const wait = formatTicksRoughly(crown.nextDemandTicks ?? 0, tuning.stepMs);
    return [copy.village.crownQuiet({ wait })];
  }

  body({ view, tuning }: MenuContext, size: PanelSize): string {
    const { crown } = view;
    if (crown === null) return "";
    const lines = [
      ...(crown.demand === null
        ? CrownPanel.quietLines(crown, tuning)
        : CrownPanel.demandLines(crown.demand, tuning)),
      "",
      copy.village.crownTally({ met: crown.met, missed: crown.missed }),
      copy.village.crownFavor[crown.favor],
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
  private static readonly repayKey = "b";
  static override readonly keys: PanelKeys = {
    id: "ledger",
    focusKey: "l",
    needs: CONJURING,
    focusLabel: copy.keys.hints.ledger,
    hints: [
      { keys: "j/k", label: copy.keys.panelActions.select },
      { keys: "enter", label: copy.keys.panelActions.conjure },
      { keys: LedgerPanel.repayKey, label: copy.keys.panelActions.repay },
      { keys: "esc", label: copy.keys.panelActions.back },
    ],
  };
  private selected = 0;

  enter(): void {
    this.selected = 0;
  }

  /** The indented line naming what is owed, and while the row is selected, what the repay key would do. */
  private owedLine(
    view: GameView,
    resource: string,
    selected: boolean,
    indent: string,
  ): string[] {
    const debt = view.illusion?.debt[resource];
    if (view.illusion === null || debt === undefined || debt.owed <= 0) {
      return [];
    }
    const { debtIsExact } = view.illusion;
    const debtFigure = new DebtFigure(debtIsExact);
    const figure = (amount: number) => debtFigure.text(amount);
    const owed = copy.ledger.owed({ figure: figure(debt.owed) });
    if (!selected) return [`${indent}${owed}`];
    const key = LedgerPanel.repayKey;
    const advice = debt.covered
      ? copy.ledger.repayAll({ key })
      : debt.repayable > 0
        ? copy.ledger.repayPart({ key, figure: figure(debt.repayable) })
        : copy.ledger.repayNone({ resource });
    return [`${indent}${owed}`, `${indent}${advice}`];
  }

  private resourceLines(
    view: GameView,
    focused: boolean,
    width: number,
  ): string[] {
    const rows = view.ledger.map((line) => [
      capitalize(line.resource),
      formatAmount(line.amount),
      formatRate(line.ratePerSecond),
    ]);
    const widths = [0, 1, 2].map((column) =>
      Math.max(0, ...rows.map((row) => row[column]?.length ?? 0)),
    );
    return rows.flatMap(([name = "", amount = "", rate = ""], index) => {
      const gutter = focused ? (index === this.selected ? "> " : "  ") : "";
      const conjured = view.ledger[index]?.conjured ?? 0;
      const eaten =
        view.ledger[index]?.resource === "grain" ? view.grainEatenPerSecond : 0;
      const indent = `${" ".repeat(gutter.length)}  `;
      const row = `${gutter}${name.padEnd(widths[0] ?? 0)} ${amount.padStart(widths[1] ?? 0)} ${rate.padStart(widths[2] ?? 0)}`;
      return [
        // A column too narrow for the eaten rate beside the grain row drops it to a line of its own.
        ...(eaten > 0
          ? wrapPhrases(
              [row, copy.ledger.eaten({ rate: formatAmount(eaten) })],
              width,
              indent.length,
            )
          : [row]),
        ...(conjured > 0
          ? [
              `${indent}${copy.ledger.conjured({ amount: formatAmount(conjured) })}`,
            ]
          : []),
        ...this.owedLine(
          view,
          view.ledger[index]?.resource ?? "",
          focused && index === this.selected,
          indent,
        ),
      ];
    });
  }

  private booksLines(view: GameView, tuning: Tuning): string[] {
    if (view.illusion === null) return [];
    const { books, auditInTicks } = view.illusion;
    return [
      copy.ledger.books({ books }),
      ...(auditInTicks === null
        ? []
        : [
            copy.ledger.auditDue({
              wait: formatTicksRoughly(auditInTicks, tuning.stepMs),
            }),
          ]),
    ];
  }

  /** One line when it fits the column, otherwise the label above its value, so neither is cut off. */
  private labelled(label: string, value: string, width: number): string[] {
    const line = `${label}  ${value}`;
    if (line.length <= width) return [line];
    return [label, ...wrapLine(`  ${value}`, width, 0)];
  }

  private titleLines(view: GameView, width: number): string[] {
    return this.labelled(
      copy.ledger.titleLabel,
      copy.ledger.title({ title: view.title, village: view.villageName }),
      width,
    );
  }

  private promotionLines(view: GameView, width: number): string[] {
    const { target, promotedAt } = view.promotion;
    if (promotedAt > 0) return [];
    return this.labelled(
      copy.ledger.promotionLabel,
      copy.ledger.promotionProgress({
        population: view.realm.population,
        target,
      }),
      width,
    );
  }

  private nextPeasantLines(view: GameView, width: number): string[] {
    const { stored, needed, perSecond, full } = view.growth;
    if (full) return [];
    const progress = copy.ledger.nextPeasantProgress({
      stored: formatAmount(stored),
      needed: plain(needed),
    });
    if (perSecond <= 0) {
      return this.labelled(copy.ledger.nextPeasantLabel, progress, width);
    }
    const seconds = Math.ceil((needed - stored) / perSecond);
    return this.labelled(
      copy.ledger.nextPeasantLabel,
      copy.ledger.nextPeasantEstimate({
        progress,
        wait: formatGameTime(seconds),
      }),
      width,
    );
  }

  body(
    { view, tuning }: MenuContext,
    size: PanelSize,
    focused: boolean,
  ): string {
    const { realm } = view;
    const rest = [
      ...this.resourceLines(view, focused, size.width),
      ...this.booksLines(view, tuning),
      "",
      ...[
        copy.ledger.peasants({
          population: realm.population,
          idle: realm.labor.idle,
        }),
        copy.ledger.labor(realm.labor),
        copy.ledger.season({ season: capitalize(realm.season) }),
      ].flatMap((line) => wrapLine(line, size.width, 2)),
      ...this.titleLines(view, size.width),
      ...this.promotionLines(view, size.width),
      ...this.nextPeasantLines(view, size.width),
    ];
    // The clock is the least useful line, so a short panel gives it up before anything else.
    if (rest.length >= size.height) return rest.join("\n");
    return [
      copy.ledger.time({ time: formatGameTime(view.elapsedSeconds) }),
      ...rest,
    ].join("\n");
  }

  key(key: KeyPress, { view, tuning }: MenuContext): PanelStep | null {
    const name = plainKeyName(key);
    if (name === "escape") return UNFOCUS;
    const move = peasantActionForKey(key);
    if (move?.kind === "move") {
      this.selected = stepIndex(view.ledger.length, this.selected, move.delta);
      return step();
    }
    const resource = view.ledger[this.selected]?.resource as Resource;
    if (name === "return" || name === "enter") {
      return step([{ type: "conjure", resource, amount: tuning.illusion.lot }]);
    }
    if (name === LedgerPanel.repayKey) {
      return step([{ type: "back", resource }]);
    }
    return null;
  }
}

/** The focusable panels keyed by id, so a missing or extra panel is a type error; key order is the reading order. */
const PANELS = {
  ledger: LedgerPanel,
  peasants: PeasantsPanel,
  archive: ArchivePanel,
  court: CourtPanel,
  decrees: DecreesPanel,
  crown: CrownPanel,
} satisfies Record<FocusId, { new (): VillagePanel; keys: PanelKeys }>;

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

/** Declared keys and hints are static, so the key tables are built once from the classes without constructing any panel. */
export const keymap = new Keymap(
  Object.values(PANELS).map((panel) => panel.keys),
);
