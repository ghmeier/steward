import { describe, expect, test } from "bun:test";
import { tuning, viewWith } from "../../test/helpers";
import { copy } from "../core/copy";
import { postingEndMenu } from "./posting-end-menu";

function notesFor(followers: string[]): string[] {
  const view = viewWith({
    prestige: {
      demandsMet: 6,
      demandsNeeded: 6,
      canEnd: true,
      ending: "promotion",
      coinAccepted: false,
      nextName: "Ashford",
      followers,
    },
  });
  const screen = postingEndMenu({ view, tuning });
  return screen.kind === "list" ? (screen.notes ?? []) : [];
}

describe("the posting-end menu", () => {
  test("names the governors who will follow, or says that none will", () => {
    const withFollowers = notesFor(["Ada", "Bram"]);
    const withoutFollowers = notesFor([]);

    expect(withFollowers).toContain(
      copy.menus.postingEndFollowers({ names: ["Ada", "Bram"] }),
    );
    expect(withFollowers.join("\n")).toContain("Ada and Bram");
    expect(withFollowers).not.toContain(copy.menus.postingEndNoFollowers);
    expect(withoutFollowers).toContain(copy.menus.postingEndNoFollowers);
  });
});
