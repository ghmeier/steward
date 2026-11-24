import { copy } from "../core/copy";
import { doctrineMenu } from "./doctrine-menu";
import type { ScreenBuilder } from "./menu";

export const postingEndMenu: ScreenBuilder = ({ view }) => ({
  kind: "list",
  title: copy.menus.postingEndTitle,
  notes: [
    copy.menus.postingEndOutlook[view.prestige.ending],
    "",
    copy.menus.postingEndKeeps,
    copy.menus.postingEndResets,
    "",
  ],
  items: [
    { label: copy.menus.stayInPosting, action: { kind: "close" } },
    {
      label: copy.menus.endPosting,
      action: { kind: "push", screen: doctrineMenu },
    },
  ],
});
