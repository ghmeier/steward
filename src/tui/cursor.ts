export type Cursor = { id: number; index: number };

/** Follows the selected peasant by id; when it is gone the row now at its old position (or the last row) is selected. */
export function reconcileCursor(
  rows: readonly { id: number }[],
  cursor: Cursor | null,
): Cursor | null {
  const first = rows[0];
  if (first === undefined) return null;
  if (cursor === null) return { id: first.id, index: 0 };
  const found = rows.findIndex((row) => row.id === cursor.id);
  if (found >= 0) return { id: cursor.id, index: found };
  return rowCursor(rows, Math.min(cursor.index, rows.length - 1));
}

function rowCursor(
  rows: readonly { id: number }[],
  index: number,
): Cursor | null {
  const row = rows[index];
  return row === undefined ? null : { id: row.id, index };
}

export function moveCursor(
  rows: readonly { id: number }[],
  cursor: Cursor | null,
  delta: -1 | 1,
): Cursor | null {
  const current = reconcileCursor(rows, cursor);
  if (current === null) return null;
  const index = Math.max(0, Math.min(rows.length - 1, current.index + delta));
  return rowCursor(rows, index);
}

export type RowWindow = { start: number; end: number };

/**
 * Picks the rows [start, end) to draw so the cursor row is always inside and the
 * "more" lines for hidden rows fit within `height` lines. A side with nothing hidden
 * needs no "more" line, so the window grows by one row there.
 */
export function rowWindow(
  total: number,
  cursorIndex: number,
  height: number,
): RowWindow {
  if (total <= height) return { start: 0, end: total };
  const visible = Math.max(1, height - 2);
  const cursor = Math.max(0, Math.min(total - 1, cursorIndex));
  let start = Math.max(
    0,
    Math.min(total - visible, cursor - Math.floor(visible / 2)),
  );
  let end = start + visible;
  if (start === 0) end += 1;
  else if (end === total) start -= 1;
  return { start, end };
}
