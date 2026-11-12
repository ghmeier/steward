import type { KeyPress } from "./keys";

function typedCharacter(key: KeyPress): string | null {
  if (key.name === "space") return " ";
  if (/^[\x20-\x7e]$/.test(key.sequence)) return key.sequence;
  // Kitty-protocol terminals send an escape sequence instead of the character.
  if (key.name === "/" && key.shift) return "?";
  if (/^[\x20-\x7e]$/.test(key.name)) {
    return key.shift ? key.name.toUpperCase() : key.name;
  }
  return null;
}

/** The text after a key that edits it, or null when the key neither types nor erases. */
export function editedText(text: string, key: KeyPress): string | null {
  if (key.name === "backspace") return text.slice(0, -1);
  const character = typedCharacter(key);
  return character === null ? null : text + character;
}

export function promptLine(text: string): string {
  return `: ${text}_`;
}
