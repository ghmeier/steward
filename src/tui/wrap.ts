/**
 * Breaks one logical line into lines of at most `width` columns at spaces. Continuation lines keep the
 * line's own leading indent plus `hanging`, so wrapped help and decree text stays aligned. A word longer
 * than the width is left whole rather than split.
 */
export function wrapLine(text: string, width: number, hanging = 0): string[] {
  const indent = text.length - text.trimStart().length;
  const limit = Math.max(1, width);
  const words = text.trimStart().split(" ");
  const lines: string[] = [];
  let current = " ".repeat(indent);
  let empty = true;
  for (const word of words) {
    if (!empty && current.length + 1 + word.length > limit) {
      lines.push(current);
      current = " ".repeat(indent + hanging);
      empty = true;
    }
    current += empty ? word : ` ${word}`;
    empty = false;
  }
  lines.push(current);
  return lines;
}

/**
 * Lays out phrases that must not be split across lines: each is joined to the last with two spaces while
 * it fits, and otherwise starts a line indented by `hanging`. A phrase wider than the line is wrapped
 * on its own words, at the same indent.
 */
export function wrapPhrases(
  phrases: readonly string[],
  width: number,
  hanging: number,
): string[] {
  const lines: string[] = [];
  let current = "";
  for (const phrase of phrases) {
    if (current === "") {
      current = phrase;
    } else if (current.length + 2 + phrase.length <= width) {
      current += `  ${phrase}`;
    } else {
      lines.push(current);
      current = `${" ".repeat(hanging)}${phrase}`;
    }
  }
  if (current !== "") lines.push(current);
  return lines.flatMap((line) => wrapLine(line, width));
}
