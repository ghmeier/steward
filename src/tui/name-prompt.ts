import { copy } from "../core/copy";
import type { KeyPress } from "./keys";
import type { MenuRender } from "./menu";
import { editedText, promptLine } from "./text-edit";

export type NamePrompt = { text: string } & (
  | {
      purpose: "village";
      /** The seed the village will be founded with, drawn when the prompt opened so the default name and the village agree. */
      seed: number;
    }
  // A new posting's seed is derived by the game, so the typed name is the only choice to make.
  | { purpose: "posting"; doctrine: string }
);

export type NameResult =
  | { kind: "editing"; prompt: NamePrompt }
  | { kind: "confirmed"; name: string }
  | { kind: "cancelled" };

export function nameKey(prompt: NamePrompt, key: KeyPress): NameResult {
  const stay: NameResult = { kind: "editing", prompt };
  if (key.name === "escape") return { kind: "cancelled" };
  if (key.ctrl || key.meta) return stay;
  if (key.name === "return" || key.name === "enter") {
    const name = prompt.text.trim();
    return name === "" ? stay : { kind: "confirmed", name };
  }
  const text = editedText(prompt.text, key);
  return text === null
    ? stay
    : { kind: "editing", prompt: { ...prompt, text } };
}

const PROMPT_COPY: Record<
  NamePrompt["purpose"],
  { title: string; hints: string }
> = {
  village: {
    title: copy.menus.namePromptTitle,
    hints: copy.menus.namePromptHints,
  },
  posting: {
    title: copy.menus.postingNamePromptTitle,
    hints: copy.menus.postingNamePromptHints,
  },
};

export function renderNamePrompt(prompt: NamePrompt): MenuRender {
  return { ...PROMPT_COPY[prompt.purpose], lines: [promptLine(prompt.text)] };
}
