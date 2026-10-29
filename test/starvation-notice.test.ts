import { describe, expect, test } from "bun:test";
import type { GameView } from "../src/core/view";
import { starvationNotice } from "../src/tui/starvation-notice";

const NAMES = ["Ada", "Hob", "Cole", "Dee", "Eli", "Fen", "Gus"];

function viewOf(names: string[], starved: number): GameView {
	return {
		realm: { population: names.length, starved },
		delegates: names.map((name) => ({ id: NAMES.indexOf(name) + 1, name })),
	} as unknown as GameView;
}

describe("starvationNotice", () => {
	test("returns null when nobody starved", () => {
		expect(starvationNotice(viewOf(NAMES, 0), viewOf(NAMES, 0))).toBeNull();
	});

	test("names a single peasant who starved", () => {
		const next = viewOf(NAMES.slice(1), 1);

		expect(starvationNotice(viewOf(NAMES, 0), next)).toBe("Ada starved.");
	});

	test("joins two peasants with and", () => {
		const next = viewOf(NAMES.slice(2), 2);

		expect(starvationNotice(viewOf(NAMES, 0), next)).toBe(
			"Ada and Hob starved.",
		);
	});

	test("names two peasants and counts the rest when five or more starved", () => {
		const next = viewOf(NAMES.slice(5), 5);

		expect(starvationNotice(viewOf(NAMES, 0), next)).toBe(
			"Ada, Hob and 3 others starved.",
		);
	});

	test("says one other, singular, when three starved", () => {
		const next = viewOf(NAMES.slice(3), 3);

		expect(starvationNotice(viewOf(NAMES, 0), next)).toBe(
			"Ada, Hob and 1 other starved.",
		);
	});

	test("does not name a peasant who left while the starved count stayed put", () => {
		const next = viewOf(NAMES.slice(1), 4);

		expect(starvationNotice(viewOf(NAMES, 4), next)).toBeNull();
	});

	test("names no more peasants than the count rose by", () => {
		const next = viewOf(NAMES.slice(2), 1);

		expect(starvationNotice(viewOf(NAMES, 0), next)).toBe("Ada starved.");
	});
});
