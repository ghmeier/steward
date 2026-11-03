import { BoxRenderable, type CliRenderer, TextRenderable } from "@opentui/core";
import type { FocusId } from "./keys";
import type { MenuContext, MenuRender } from "./menu";
import {
  LedgerPanel,
  type PanelSize,
  panelTitle,
  type Village,
} from "./village-panels";

export type PanelsFrame = {
  context: MenuContext;
  message: string | null;
  barHints: string;
  focus: FocusId | null;
};

export type Panels = {
  update(frame: PanelsFrame): void;
  showOverlay(overlay: MenuRender | null): void;
};

const LOCKED_BODY = "Locked.";
export const BAR_LINES = 1;
const BORDER_COLOR = "#6b7280";
const FOCUS_COLOR = "#f5c542";
const BORDER_AND_PADDING = 3;

type Slot = { box: BoxRenderable; text: TextRenderable; weight: number };

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

  const makeSlot = (id: string, name: string, weight: number): Slot => {
    const box = new BoxRenderable(renderer, {
      id,
      title: panelTitle(name),
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
    return { box, text, weight };
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

  const ledgerPanel = new LedgerPanel();
  const ledger = makeSlot("ledger", ledgerPanel.name, 1);
  const focusable = new Map(
    village.panels.map((panel) => [
      panel.id,
      makeSlot(panel.id, panel.name, panel.id === "archive" ? 2 : 1),
    ]),
  );
  const slotFor = (id: FocusId): Slot => {
    const slot = focusable.get(id);
    if (slot === undefined) throw new Error(`no slot for ${id}`);
    return slot;
  };
  const topRow = [ledger, slotFor("peasants"), slotFor("archive")];
  const bottomRow = [slotFor("court"), slotFor("decrees")];
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
  container.add(grid);
  container.add(overlayBox);
  container.add(bar);
  renderer.root.add(container);

  // OpenTUI computes layout lazily, so each panel's inner size is derived from the terminal: the bar
  // comes off the height, the grid splits into two equal rows, and the row's width splits by weight.
  const sizeOf = (slot: Slot, row: Slot[]): PanelSize => {
    const total = row.reduce((sum, item) => sum + item.weight, 0);
    return {
      width: Math.max(
        1,
        Math.floor((renderer.width * slot.weight) / total) - BORDER_AND_PADDING,
      ),
      height: Math.max(1, Math.floor((renderer.height - BAR_LINES) / 2) - 2),
    };
  };
  const rowOf = (slot: Slot) => (topRow.includes(slot) ? topRow : bottomRow);

  return {
    update({ context, message: text, barHints: hints, focus }) {
      const { view } = context;
      const isLocked = (id: string) =>
        view.lockedPanels.some((locked) => locked === id);
      ledger.text.content = ledgerPanel.body(
        view,
        sizeOf(ledger, rowOf(ledger)),
      );
      for (const panel of village.panels) {
        const slot = slotFor(panel.id);
        const focused = focus === panel.id;
        const size = sizeOf(slot, rowOf(slot));
        slot.text.content = isLocked(panel.id)
          ? LOCKED_BODY
          : panel.body(context, size, focused);
        slot.box.borderStyle = focused ? "double" : "single";
        slot.box.borderColor = focused ? FOCUS_COLOR : BORDER_COLOR;
        slot.box.bottomTitle = focused
          ? panel.hints(context, size.width - 2)
          : undefined;
      }
      message.content = text ?? "";
      barHints.content = hints;
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
