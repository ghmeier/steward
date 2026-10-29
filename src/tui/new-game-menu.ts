import type { ScreenBuilder } from "./menu";

export const newGameMenu: ScreenBuilder = () => ({
	kind: "list",
	title: "Found a new village?",
	notes: [
		"The current village will be abandoned and the save overwritten.",
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
