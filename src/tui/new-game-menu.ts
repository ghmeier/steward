import type { ScreenBuilder } from "./menu";

export const newGameMenu: ScreenBuilder = ({ view }) => ({
	kind: "list",
	title: "Found a new village?",
	notes: [
		"The current village will be abandoned and the save overwritten.",
		...(view.unlocks.length > 0 || view.savedDecrees.length > 0
			? ["Anything bought in the Archive and every saved decree is lost too."]
			: []),
		"The previous save stays as the backup file.",
		"",
	],
	items: [
		{ label: "No, keep this village", action: { kind: "close" } },
		{
			label: "Yes, found a new village",
			action: { kind: "app", request: "newGame" },
		},
	],
});
