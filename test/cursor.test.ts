import { describe, expect, test } from "bun:test";
import { moveCursor, reconcileCursor, rowWindow } from "../src/tui/cursor";

const rows = (...ids: number[]) => ids.map((id) => ({ id }));

describe("reconcileCursor", () => {
	test("selects the first row when nothing was selected", () => {
		expect(reconcileCursor(rows(4, 5), null)).toEqual({ id: 4, index: 0 });
	});

	test("keeps following the selected peasant when a birth shifts nothing before it", () => {
		const cursor = { id: 5, index: 1 };

		expect(reconcileCursor(rows(4, 5, 9), cursor)).toEqual(cursor);
	});

	test("follows the selected peasant to a new index when an earlier peasant dies", () => {
		expect(reconcileCursor(rows(5, 9), { id: 5, index: 1 })).toEqual({
			id: 5,
			index: 0,
		});
	});

	test("selects the row now at the same position when the selected peasant dies", () => {
		expect(reconcileCursor(rows(4, 9), { id: 5, index: 1 })).toEqual({
			id: 9,
			index: 1,
		});
	});

	test("selects the last row when the selected peasant was last and dies", () => {
		expect(reconcileCursor(rows(4, 5), { id: 9, index: 2 })).toEqual({
			id: 5,
			index: 1,
		});
	});

	test("selects nothing when the village is empty", () => {
		expect(reconcileCursor([], { id: 1, index: 0 })).toBeNull();
	});
});

describe("moveCursor", () => {
	test("moves down and up by one row", () => {
		const down = moveCursor(rows(1, 2, 3), { id: 1, index: 0 }, 1);

		expect(down).toEqual({ id: 2, index: 1 });
		expect(moveCursor(rows(1, 2, 3), down, -1)).toEqual({ id: 1, index: 0 });
	});

	test("stops at the first and last rows", () => {
		expect(moveCursor(rows(1, 2), { id: 1, index: 0 }, -1)).toEqual({
			id: 1,
			index: 0,
		});
		expect(moveCursor(rows(1, 2), { id: 2, index: 1 }, 1)).toEqual({
			id: 2,
			index: 1,
		});
	});

	test("moves from the nearest remaining row when the selected peasant has died", () => {
		expect(moveCursor(rows(4, 9), { id: 5, index: 1 }, -1)).toEqual({
			id: 4,
			index: 0,
		});
	});

	test("returns null with no rows", () => {
		expect(moveCursor([], null, 1)).toBeNull();
	});
});

describe("rowWindow", () => {
	test("shows every row with no more-lines when they all fit", () => {
		expect(rowWindow(5, 2, 8)).toEqual({ start: 0, end: 5 });
	});

	test("at the top the window starts at row 0 and leaves room for one below-line", () => {
		const { start, end } = rowWindow(40, 0, 10);

		expect(start).toBe(0);
		expect(end).toBe(9);
		expect(40 - end).toBe(31);
	});

	test("at the bottom the window ends at the last row and leaves room for one above-line", () => {
		const { start, end } = rowWindow(40, 39, 10);

		expect(end).toBe(40);
		expect(start).toBe(31);
	});

	test("every cursor position stays inside a window that fits the height and the rows", () => {
		for (const total of [11, 19, 40]) {
			for (let cursor = 0; cursor < total; cursor++) {
				const { start, end } = rowWindow(total, cursor, 10);
				const lines = end - start + (start > 0 ? 1 : 0) + (end < total ? 1 : 0);

				expect(start).toBeGreaterThanOrEqual(0);
				expect(end).toBeLessThanOrEqual(total);
				expect(cursor).toBeGreaterThanOrEqual(start);
				expect(cursor).toBeLessThan(end);
				expect(lines).toBeLessThanOrEqual(10);
			}
		}
	});
});
