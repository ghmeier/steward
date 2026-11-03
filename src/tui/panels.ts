import { BoxRenderable, type CliRenderer, TextRenderable } from "@opentui/core";
import { type FocusId, panelHintsText } from "./keys";
import type { MenuContext, MenuRender } from "./menu";
import type { PanelSize, Village } from "./village-panels";
import { wrapLine } from "./wrap";

export type PanelsFrame = {
  context: MenuContext;
  message: string | null;
  barHints: string;
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
const BORDER_AND_PADDING = 3;
const BORDER_ROWS = 2;
const LINE_Z_INDEX = 100;
const LINE_BACKGROUND = "#000000";
// Input row and problem row, which the grown bar always keeps room for besides the suggestions.
const LINE_FIXED_ROWS = 2;

type Slot = { box: BoxRenderable; text: TextRenderable };

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

  // Layout is computed natively while a frame renders, so a box reports 0 x 0 until its first paint.
  // The first frame is drawn against the whole terminal, which only over-estimates, and the size
  // change that follows that paint redraws each panel at its real size.
  let lastFrame: PanelsFrame | null = null;
  let correctionQueued = false;
  const drawnSize = new Map<Slot, string>();
  const sizeOf = (slot: Slot): PanelSize =>
    slot.box.width === 0
      ? { width: renderer.width, height: renderer.height }
      : {
          width: Math.max(1, slot.box.width - BORDER_AND_PADDING),
          height: Math.max(1, slot.box.height - BORDER_ROWS),
        };
  const sizeKey = (slot: Slot) => JSON.stringify(sizeOf(slot));
  const correctSizes = () => {
    if (correctionQueued) return;
    correctionQueued = true;
    // Redrawing inside the render pass would be dropped, so the correction waits for the pass to end.
    process.nextTick(() => {
      correctionQueued = false;
      if (renderer.isDestroyed || lastFrame === null) return;
      draw(lastFrame);
      renderer.requestRender();
    });
  };

  const makeSlot = (id: string, name: string, weight: number): Slot => {
    const box = new BoxRenderable(renderer, {
      id,
      title: `(${name.charAt(0)})${name.slice(1)}`,
      border: true,
      borderStyle: "single",
      borderColor: BORDER_COLOR,
      flexGrow: weight,
      flexBasis: 0,
      paddingLeft: 1,
    });
    const text = new TextRenderable(renderer, {
      id: `${id}-text`,
      content: "",
    });
    box.add(text);
    const slot: Slot = { box, text };
    box.onSizeChange = () => {
      if (drawnSize.get(slot) !== sizeKey(slot)) correctSizes();
    };
    return slot;
  };
  const makeRow = (id: string, slots: Slot[]) => {
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
    makeSlot(id, panels[id].name, weight);
  const ledger = makeSlot("ledger", ledgerPanel.name, 1);
  const slots: Record<FocusId, Slot> = {
    peasants: slotOf("peasants", 1),
    archive: slotOf("archive", 2),
    court: slotOf("court", 1),
    decrees: slotOf("decrees", 1),
  };
  const topRow = [ledger, slots.peasants, slots.archive];
  const bottomRow = [slots.court, slots.decrees];
  grid.add(makeRow("top-row", topRow));
  grid.add(makeRow("bottom-row", bottomRow));

  const message = new TextRenderable(renderer, {
    id: "bar-message",
    content: "",
    flexGrow: 1,
    height: BAR_LINES,
  });
  const barHints = new TextRenderable(renderer, {
    id: "bar-hints",
    content: "",
    flexShrink: 0,
    height: BAR_LINES,
  });
  const bar = new BoxRenderable(renderer, {
    id: "bar",
    flexDirection: "row",
    height: BAR_LINES,
    flexShrink: 0,
  });
  bar.add(message);
  bar.add(barHints);

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
  // Absolute so the grown bar floats over the grid and never changes the panels' sizes.
  const lineBox = new BoxRenderable(renderer, {
    id: "line",
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: LINE_Z_INDEX,
    border: true,
    backgroundColor: LINE_BACKGROUND,
    paddingLeft: 1,
    paddingRight: 1,
    visible: false,
  });
  const lineText = new TextRenderable(renderer, {
    id: "line-text",
    content: "",
  });
  lineBox.add(lineText);
  container.add(grid);
  container.add(overlayBox);
  container.add(bar);
  container.add(lineBox);
  renderer.root.add(container);

  const draw = ({
    context,
    message: text,
    barHints: hints,
    focus,
  }: PanelsFrame) => {
    const { view } = context;
    const isLocked = (id: string) =>
      view.lockedPanels.some((locked) => locked === id);
    const render = (slot: Slot, body: (size: PanelSize) => string) => {
      const size = sizeOf(slot);
      drawnSize.set(slot, sizeKey(slot));
      slot.text.content = body(size);
      return size;
    };
    render(ledger, (size) => ledgerPanel.body(view, size));
    for (const panel of Object.values(panels)) {
      const slot = slots[panel.id];
      const focused = focus === panel.id;
      const size = render(slot, (fit) =>
        isLocked(panel.id) ? LOCKED_BODY : panel.body(context, fit, focused),
      );
      slot.box.borderStyle = focused ? "double" : "single";
      slot.box.borderColor = focused ? FOCUS_COLOR : BORDER_COLOR;
      slot.box.bottomTitle = focused
        ? panelHintsText(panel.id, size.width - 2)
        : undefined;
    }
    message.content = text ?? "";
    barHints.content = hints;
  };

  return {
    update(frame) {
      lastFrame = frame;
      draw(frame);
    },
    get lineSuggestionBudget() {
      return Math.max(
        1,
        Math.floor(renderer.height / 2) - BORDER_ROWS - LINE_FIXED_ROWS,
      );
    },
    showLine(line) {
      lineBox.visible = line !== null;
      if (line === null) return;
      const lines = line.lines.flatMap((row) =>
        wrapLine(row, renderer.width - BORDER_ROWS - 2, 2),
      );
      lineBox.title = line.title;
      lineBox.bottomTitle = line.hints;
      lineBox.height = lines.length + BORDER_ROWS;
      lineText.content = lines.join("\n");
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
