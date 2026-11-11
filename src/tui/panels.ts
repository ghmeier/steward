import {
  BoxRenderable,
  type CliRenderer,
  RGBA,
  TextRenderable,
} from "@opentui/core";
import {
  BAR_HINTS,
  barCommandsText,
  type FocusId,
  panelHintsText,
} from "./keys";
import type { MenuContext, MenuRender } from "./menu";
import type { PanelSize, Village } from "./village-panels";
import { wrapLine } from "./wrap";

export type PanelsFrame = {
  context: MenuContext;
  message: string | null;
  focus: FocusId | null;
};

export type Panels = {
  update(frame: PanelsFrame): void;
  showOverlay(overlay: MenuRender | null): void;
  /** Grows the bar upward over the grid to show the command line, or collapses it when given null. */
  showLine(line: MenuRender | null): void;
  /** How many suggestions fit in the grown bar, so a short terminal shows fewer. */
  readonly lineSuggestionBudget: number;
};

const LOCKED_BODY = "Locked.";
export const BAR_LINES = 1;
const BORDER_COLOR = "#6b7280";
const FOCUS_COLOR = "#f5c542";
const BORDER = 1;
const PADDING = 1;
const BAR_GAP = 1;

class PanelSlot {
  readonly box: BoxRenderable;
  readonly text: TextRenderable;
  private drawnSize: PanelSize | null = null;

  constructor(
    private readonly renderer: CliRenderer,
    id: string,
    title: string,
    weight: number,
    onResize: () => void,
  ) {
    this.box = new BoxRenderable(renderer, {
      id,
      title,
      border: true,
      borderStyle: "single",
      borderColor: BORDER_COLOR,
      flexGrow: weight,
      flexBasis: 0,
      paddingLeft: PADDING,
    });
    this.text = new TextRenderable(renderer, {
      id: `${id}-text`,
      content: "",
    });
    this.box.add(this.text);
    this.box.onSizeChange = () => {
      if (this.isStale) onResize();
    };
  }

  /**
   * Layout is computed natively while a frame renders, so a box reports 0 x 0 until its first paint.
   * Until then the panel is sized to the whole terminal, which only over-estimates.
   */
  get size(): PanelSize {
    if (this.box.width === 0) {
      return { width: this.renderer.width, height: this.renderer.height };
    }
    return {
      width: Math.max(1, this.box.width - 2 * BORDER - PADDING),
      height: Math.max(1, this.box.height - 2 * BORDER),
    };
  }

  get isStale(): boolean {
    const { width, height } = this.size;
    return this.drawnSize?.width !== width || this.drawnSize.height !== height;
  }

  draw(body: (size: PanelSize) => string): PanelSize {
    this.drawnSize = this.size;
    this.text.content = body(this.drawnSize);
    return this.drawnSize;
  }
}

/**
 * One row with the command reminder on the left and the notice followed by the help hints on the right.
 * The notice gives way first, losing its end so its opening words survive, and the hints never move.
 */
class StatusBar {
  private static readonly ELLIPSIS = "\u2026";
  readonly box: BoxRenderable;
  private readonly text: TextRenderable;

  constructor(private readonly renderer: CliRenderer) {
    this.box = new BoxRenderable(renderer, {
      id: "bar",
      height: BAR_LINES,
      flexShrink: 0,
    });
    this.text = new TextRenderable(renderer, {
      id: "bar-text",
      content: "",
      height: BAR_LINES,
    });
    this.box.add(this.text);
  }

  private static fit(notice: string, room: number): string {
    if (notice.length <= room) return notice;
    if (room <= 0) return "";
    return notice.slice(0, room - 1) + StatusBar.ELLIPSIS;
  }

  private rightSide(commands: string, notice: string): string {
    const room =
      this.renderer.width - commands.length - BAR_HINTS.length - 2 * BAR_GAP;
    const shown = StatusBar.fit(notice, room);
    return shown === "" ? BAR_HINTS : `${shown} ${BAR_HINTS}`;
  }

  show(unlocks: readonly string[], notice: string) {
    const commands = barCommandsText(unlocks);
    const right = this.rightSide(commands, notice);
    const padding = Math.max(
      BAR_GAP,
      this.renderer.width - commands.length - right.length,
    );
    this.text.content = commands + " ".repeat(padding) + right;
  }
}

/** The command line, drawn over the bottom of the grid so the panels never resize while it is open. */
class CommandBar {
  /** The bar may cover at most half the terminal, less its border and the input and problem rows. */
  private static readonly ROWS_BESIDE_SUGGESTIONS = 2 * BORDER + 2;
  readonly box: BoxRenderable;
  private readonly text: TextRenderable;

  constructor(private readonly renderer: CliRenderer) {
    this.box = new BoxRenderable(renderer, {
      id: "line",
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 100,
      border: true,
      // The terminal's own background, so the bar hides the grid without painting a slab on light themes.
      backgroundColor: RGBA.defaultBackground(),
      paddingLeft: PADDING,
      paddingRight: PADDING,
      visible: false,
    });
    this.text = new TextRenderable(renderer, { id: "line-text", content: "" });
    this.box.add(this.text);
  }

  get suggestionBudget(): number {
    return (
      Math.floor(this.renderer.height / 2) - CommandBar.ROWS_BESIDE_SUGGESTIONS
    );
  }

  private get textWidth(): number {
    return this.renderer.width - 2 * (BORDER + PADDING);
  }

  show(line: MenuRender | null) {
    this.box.visible = line !== null;
    if (line === null) return;
    const lines = line.lines.flatMap((row) => wrapLine(row, this.textWidth, 2));
    this.box.title = line.title;
    this.box.bottomTitle = line.hints;
    this.box.height = lines.length + 2 * BORDER;
    this.text.content = lines.join("\n");
  }
}

export function createPanels(renderer: CliRenderer, village: Village): Panels {
  const container = new BoxRenderable(renderer, {
    id: "layout",
    flexDirection: "column",
    width: "100%",
    height: "100%",
  });
  const grid = new BoxRenderable(renderer, {
    id: "grid",
    flexDirection: "column",
    flexGrow: 1,
  });

  let lastFrame: PanelsFrame | null = null;
  let redrawQueued = false;
  // A panel learns its real size during a paint, and redrawing inside the render pass would be dropped,
  // so the redraw at the measured size waits for the pass to end.
  const redrawAtMeasuredSize = () => {
    if (redrawQueued) return;
    redrawQueued = true;
    process.nextTick(() => {
      redrawQueued = false;
      if (renderer.isDestroyed || lastFrame === null) return;
      draw(lastFrame);
      renderer.requestRender();
    });
  };
  const makeSlot = (id: string, title: string, weight: number) =>
    new PanelSlot(renderer, id, title, weight, redrawAtMeasuredSize);
  const makeRow = (id: string, slots: PanelSlot[]) => {
    const row = new BoxRenderable(renderer, {
      id,
      flexDirection: "row",
      flexGrow: 1,
      flexBasis: 0,
    });
    for (const slot of slots) row.add(slot.box);
    return row;
  };

  const { ledger: ledgerPanel, focusable: panels } = village;
  const slotOf = (id: FocusId, weight: number) =>
    makeSlot(id, panels[id].title, weight);
  const ledger = makeSlot("ledger", ledgerPanel.title, 1);
  const slots: Record<FocusId, PanelSlot> = {
    peasants: slotOf("peasants", 1),
    archive: slotOf("archive", 2),
    court: slotOf("court", 1),
    decrees: slotOf("decrees", 1),
    crown: slotOf("crown", 1),
  };
  const topRow = [ledger, slots.peasants, slots.archive];
  const bottomRow = [slots.court, slots.decrees, slots.crown];
  grid.add(makeRow("top-row", topRow));
  grid.add(makeRow("bottom-row", bottomRow));

  const bar = new StatusBar(renderer);

  // Replaces the grid rather than floating over it, so the overlay never fights panel layout.
  const overlayBox = new BoxRenderable(renderer, {
    id: "menu",
    border: true,
    flexGrow: 1,
    paddingLeft: 1,
    paddingRight: 1,
    visible: false,
  });
  const overlayText = new TextRenderable(renderer, {
    id: "menu-text",
    content: "",
  });
  overlayBox.add(overlayText);
  const commandBar = new CommandBar(renderer);
  container.add(grid);
  container.add(overlayBox);
  container.add(bar.box);
  container.add(commandBar.box);
  renderer.root.add(container);

  const draw = ({ context, message: text, focus }: PanelsFrame) => {
    const { view } = context;
    const isLocked = (id: string) =>
      view.lockedPanels.some((locked) => locked === id);
    ledger.draw((size) => ledgerPanel.body(view, size));
    for (const panel of Object.values(panels)) {
      const slot = slots[panel.id];
      const locked = isLocked(panel.id);
      slot.box.visible = !(locked && panel.hiddenWhileLocked);
      if (!slot.box.visible) continue;
      const focused = focus === panel.id;
      const size = slot.draw((fit) =>
        locked ? LOCKED_BODY : panel.body(context, fit, focused),
      );
      slot.box.borderStyle = focused ? "double" : "single";
      slot.box.borderColor = focused ? FOCUS_COLOR : BORDER_COLOR;
      slot.box.bottomTitle = focused
        ? panelHintsText(panel.id, size.width - 2)
        : undefined;
    }
    bar.show(view.unlocks, text ?? "");
  };

  return {
    update(frame) {
      lastFrame = frame;
      draw(frame);
    },
    get lineSuggestionBudget() {
      return commandBar.suggestionBudget;
    },
    showLine(line) {
      commandBar.show(line);
    },
    showOverlay(overlay) {
      grid.visible = overlay === null;
      overlayBox.visible = overlay !== null;
      if (overlay === null) return;
      overlayBox.title = overlay.title;
      overlayBox.bottomTitle = overlay.hints;
      overlayText.content = overlay.lines.join("\n");
    },
  };
}
