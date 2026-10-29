import { BoxRenderable, type CliRenderer, TextRenderable } from "@opentui/core";
import type { GameView, PanelId } from "../core/view";
import { rowWindow } from "./cursor";
import { plain } from "./decree-format";
import { formatAmount, formatGameTime, formatRate } from "./format";
import type { MenuRender } from "./menu";

export type Panels = {
	update(view: GameView, footer: string, selectedId: number | null): void;
	showMenu(menu: MenuRender | null): void;
};

const CROWN_PLACEHOLDER = "The crown demands nothing, for now.";
const FOOTER_LINES = 2;
const LOCKED_BODY = "Locked.";
const COURT_HINT = "Press c to hold court.";
const DESK_PLACEHOLDER = "The desk is clear.";
const EMPTY_VILLAGE = "The village is empty. Press n to found a new one.";

function capitalize(id: string): string {
	return id.charAt(0).toUpperCase() + id.slice(1);
}

function promotionLine(view: GameView): string {
	const { target, promotedAt, promotedAtSeconds } = view.promotion;
	if (promotedAt > 0) {
		return `Promoted to steward on ${formatGameTime(promotedAtSeconds)}`;
	}
	return `Promotion  ${view.realm.population} / ${target} peasants`;
}

export function nextPeasantLine(view: GameView): string | null {
	const { stored, needed, perSecond, full } = view.growth;
	if (full) return null;
	const progress = `${formatAmount(stored)} / ${plain(needed)} grain`;
	if (perSecond <= 0) return `Next peasant  ${progress}`;
	const seconds = Math.ceil((needed - stored) / perSecond);
	return `Next peasant  ${progress}  (~${formatGameTime(seconds)})`;
}

function deskLines(view: GameView): string[] {
	if (view.desk.length === 0) return [];
	return [...view.desk.map((entry) => entry.label), "", COURT_HINT];
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
	const realmLines: (string | null)[] = [
		`Population  ${realm.population} (${realm.idle} idle)`,
		`Farm ${realm.labor.farm}  Forest ${realm.labor.forest}  Mine ${realm.labor.mine}`,
		`Season  ${capitalize(realm.season)}`,
		promotionLine(view),
		nextPeasantLine(view),
	];
	return [
		`Time  ${formatGameTime(view.elapsedSeconds)}`,
		...lines,
		"",
		...realmLines.filter((line) => line !== null),
	].join("\n");
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
	if (start > 0) lines.unshift(`\u2191 ${start} more`);
	if (end < rows.length) lines.push(`\u2193 ${rows.length - end} more`);
	return lines;
}

function linesOrPlaceholder(lines: string[], placeholder: string): string {
	return lines.length > 0 ? lines.join("\n") : placeholder;
}

function peasantsBody(
	view: GameView,
	selectedId: number | null,
	height: number,
): string {
	if (view.realm.population === 0) return EMPTY_VILLAGE;
	return peasantLines(view, selectedId, height).join("\n");
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
		height: 2,
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

	// OpenTUI computes layout lazily, so the bottom row's inner height is derived from the terminal:
	// the two footer lines come off, the grid splits in two equal rows, and each border takes two lines.
	const peasantRowCapacity = () =>
		Math.max(1, Math.floor((renderer.height - FOOTER_LINES) / 2) - 2);

	return {
		update(view, footerText, selectedId) {
			const body = (id: PanelId, content: string) =>
				view.lockedPanels.includes(id) ? LOCKED_BODY : content;
			ledger.text.content = body("ledger", ledgerContent(view));
			crown.text.content = body(
				"crown",
				view.crown?.label ?? CROWN_PLACEHOLDER,
			);
			desk.text.content = body(
				"desk",
				linesOrPlaceholder(deskLines(view), DESK_PLACEHOLDER),
			);
			peasants.text.content = body(
				"peasants",
				peasantsBody(view, selectedId, peasantRowCapacity()),
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
