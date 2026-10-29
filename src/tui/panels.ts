import { BoxRenderable, type CliRenderer, TextRenderable } from "@opentui/core";
import type { GameView } from "../core/view";
import { formatAmount, formatGameTime, formatRate } from "./format";
import type { MenuRender } from "./menu";

export type Panels = {
	update(view: GameView, footer: string, selectedId: number | null): void;
	showMenu(menu: MenuRender | null): void;
};

const CROWN_PLACEHOLDER = "The crown demands nothing, for now.";
const DESK_PLACEHOLDER = "The desk is clear.";
const PEASANTS_PLACEHOLDER = "No peasants live here.";

function capitalize(id: string): string {
	return id.charAt(0).toUpperCase() + id.slice(1);
}

function ledgerContent(view: GameView): string {
	const rows = view.ledger.map((line) => [
		capitalize(line.resource),
		formatAmount(line.amount),
		formatRate(line.ratePerSecond),
	]);
	const widths = [0, 1, 2].map((column) =>
		Math.max(0, ...rows.map((row) => row[column]?.length ?? 0)),
	);
	const lines = rows.map(
		([name = "", amount = "", rate = ""]) =>
			`${name.padEnd(widths[0] ?? 0)}  ${amount.padStart(widths[1] ?? 0)}  ${rate.padStart(widths[2] ?? 0)}`,
	);
	const { realm } = view;
	const realmLines = [
		`Population  ${realm.population} (${realm.idle} idle)`,
		`Farm ${realm.labor.farm}  Forest ${realm.labor.forest}  Mine ${realm.labor.mine}`,
		`Season  ${capitalize(realm.season)}`,
	];
	return [
		`Time  ${formatGameTime(view.elapsedSeconds)}`,
		...lines,
		"",
		...realmLines,
	].join("\n");
}

export function peasantLines(
	view: GameView,
	selectedId: number | null,
): string[] {
	return view.delegates.map((delegate) => {
		const cursor = delegate.id === selectedId ? ">" : " ";
		const grudge = delegate.grudgeTicks > 0 ? " (grudge)" : "";
		return `${cursor} ${delegate.name}  ${delegate.job}${grudge}`;
	});
}

function linesOrPlaceholder(lines: string[], placeholder: string): string {
	return lines.length > 0 ? lines.join("\n") : placeholder;
}

export function createPanels(renderer: CliRenderer): Panels {
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

	const makePanel = (id: string, title: string) => {
		const box = new BoxRenderable(renderer, {
			id,
			title,
			border: true,
			flexGrow: 1,
			flexBasis: 0,
			paddingLeft: 1,
			paddingRight: 1,
		});
		const text = new TextRenderable(renderer, {
			id: `${id}-text`,
			content: "",
		});
		box.add(text);
		return { box, text };
	};
	const ledger = makePanel("ledger", "Ledger");
	const crown = makePanel("crown", "Crown");
	const desk = makePanel("desk", "Desk");
	const peasants = makePanel("peasants", "Peasants");

	const makeRow = (id: string, left: BoxRenderable, right: BoxRenderable) => {
		const row = new BoxRenderable(renderer, {
			id,
			flexDirection: "row",
			flexGrow: 1,
			flexBasis: 0,
		});
		row.add(left);
		row.add(right);
		return row;
	};
	grid.add(makeRow("top-row", ledger.box, crown.box));
	grid.add(makeRow("bottom-row", desk.box, peasants.box));

	const footer = new TextRenderable(renderer, {
		id: "footer",
		content: "",
		height: 1,
		flexShrink: 0,
	});
	// Replaces the grid rather than floating over it, so the menu never fights panel layout.
	const menuBox = new BoxRenderable(renderer, {
		id: "menu",
		border: true,
		flexGrow: 1,
		paddingLeft: 1,
		paddingRight: 1,
		visible: false,
	});
	const menuText = new TextRenderable(renderer, {
		id: "menu-text",
		content: "",
	});
	menuBox.add(menuText);
	container.add(grid);
	container.add(menuBox);
	container.add(footer);
	renderer.root.add(container);

	return {
		update(view, footerText, selectedId) {
			ledger.text.content = ledgerContent(view);
			crown.text.content = view.crown?.label ?? CROWN_PLACEHOLDER;
			desk.text.content = linesOrPlaceholder(
				view.desk.map((entry) => entry.label),
				DESK_PLACEHOLDER,
			);
			peasants.text.content = linesOrPlaceholder(
				peasantLines(view, selectedId),
				PEASANTS_PLACEHOLDER,
			);
			footer.content = footerText;
		},
		showMenu(menu) {
			grid.visible = menu === null;
			menuBox.visible = menu !== null;
			if (menu === null) return;
			menuBox.title = menu.title;
			menuText.content = menu.lines.join("\n");
		},
	};
}
