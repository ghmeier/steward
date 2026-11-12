import { copy } from "../core/copy";
import type { KeyPress } from "./keys";
import type { MenuRender } from "./menu";
import { editedText } from "./text-edit";

export type NamePrompt = {
  /** The seed the village will be founded with, drawn when the prompt opened so the default name and the village agree. */
  seed: number;
  text: string;
};

export type NameResult =
  | { kind: "editing"; prompt: NamePrompt }
  | { kind: "confirmed"; name: string }
  | { kind: "cancelled" };

export function nameKey(prompt: NamePrompt, key: KeyPress): NameResult {
  if (key.name === "escape") return { kind: "cancelled" };
  if (key.ctrl || key.meta) return { kind: "editing", prompt };
  if (key.name === "return" || key.name === "enter") {
    const name = prompt.text.trim();
    return name === ""
      ? { kind: "editing", prompt }
      : { kind: "confirmed", name };
  }
  const text = editedText(prompt.text, key);
  return {
    kind: "editing",
    prompt: text === null ? prompt : { ...prompt, text },
  };
}

export function renderNamePrompt(prompt: NamePrompt): MenuRender {
  return {
    title: copy.menus.namePromptTitle,
    lines: [`: ${prompt.text}_`],
    hints: copy.menus.namePromptHints,
  };
}
