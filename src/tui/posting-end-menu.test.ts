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
      nextName: "Ashford",
      followers,
    },
  });
  const screen = postingEndMenu({ view, tuning });
  return screen.kind === "list" ? (screen.notes ?? []) : [];
}

describe("the posting-end menu", () => {
  test("names the governors who will follow", () => {
    const notes = notesFor(["Ada", "Bram"]);

    expect(notes).toContain(
      copy.menus.postingEndFollowers({ names: "Ada and Bram" }),
    );
    expect(notes).not.toContain(copy.menus.postingEndNoFollowers);
  });

  test("says so when no governor will follow", () => {
    const notes = notesFor([]);

    expect(notes).toContain(copy.menus.postingEndNoFollowers);
  });
});
