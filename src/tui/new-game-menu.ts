import { copy } from "../core/copy";
import type { ScreenBuilder } from "./menu";

export const newGameMenu: ScreenBuilder = ({ view }) => ({
  kind: "list",
  title: copy.menus.newVillageTitle,
  notes: [
    copy.menus.newVillageAbandons,
    ...(view.unlocks.length > 0 || view.savedDecrees.length > 0
      ? [copy.menus.newVillageLosesPurchases]
      : []),
    copy.menus.newVillageKeepsBackup,
    "",
  ],
  items: [
    { label: copy.menus.keepVillage, action: { kind: "close" } },
    {
      label: copy.menus.foundVillage,
      action: { kind: "app", request: "newGame" },
    },
  ],
});
