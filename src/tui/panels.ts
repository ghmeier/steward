import { BoxRenderable, type CliRenderer, TextRenderable } from "@opentui/core";
import type { GameView } from "../core/view";
import { formatAmount, formatGameTime, formatRate } from "./format";

export type Panels = { update(view: GameView, footer: string): void };

const CROWN_PLACEHOLDER = "The crown demands nothing, for now.";
const DESK_PLACEHOLDER = "The desk is clear.";
const GOVERNORS_PLACEHOLDER = "No governors serve you yet.";

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
	const governors = makePanel("governors", "Governors");

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
	grid.add(makeRow("bottom-row", desk.box, governors.box));

	const footer = new TextRenderable(renderer, {
		id: "footer",
		content: "",
		height: 1,
		flexShrink: 0,
	});
	container.add(grid);
	container.add(footer);
	renderer.root.add(container);

	return {
		update(view, footerText) {
			ledger.text.content = ledgerContent(view);
			crown.text.content = view.crown?.label ?? CROWN_PLACEHOLDER;
			desk.text.content = linesOrPlaceholder(
				view.desk.map((entry) => entry.label),
				DESK_PLACEHOLDER,
			);
			governors.text.content = linesOrPlaceholder(
				view.governors.map((governor) => governor.name),
				GOVERNORS_PLACEHOLDER,
			);
			footer.content = footerText;
		},
	};
}
