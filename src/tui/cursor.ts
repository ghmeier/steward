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
