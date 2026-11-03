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
