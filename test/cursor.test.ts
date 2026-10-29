import { describe, expect, test } from "bun:test";
import { moveCursor, reconcileCursor } from "../src/tui/cursor";

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
