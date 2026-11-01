import { describe, expect, test } from "bun:test";
import type { Command } from "../src/core/commands";
import type { Condition } from "../src/core/decree";
import { createNewGame } from "../src/core/state";
import {
	createStrategyPlayer,
	parseStrategy,
	type Reaction,
} from "../src/runner/strategy";
import { setRoster, tuning } from "./helpers";

const noop: Command = { type: "noop" };
const sell: Command = {
	type: "enactDecree",
	decree: { id: "granary", petition: "harvest", rules: [], otherwise: "sell" },
};
const populationAbove: Condition = {
	kind: "compare",
	quantity: "population",
	comparison: "above",
	value: 5,
};
const grainAbove: Condition = {
	kind: "compare",
	quantity: "grain",
	comparison: "above",
	value: 100,
};

function parse(value: unknown) {
	return parseStrategy(value, tuning.decrees);
}

function messageOf(value: unknown): string {
	try {
		parse(value);
	} catch (error) {
		return (error as Error).message;
	}
	return "";
}

describe("parseStrategy", () => {
	test("a valid strategy parses into commands and conditions", () => {
		const strategy = parse({
			name: "s",
			setup: [sell],
			reactions: [{ when: grainAbove, commands: [noop] }],
		});

		expect(strategy.name).toBe("s");
		expect(strategy.setup).toEqual([sell]);
		expect(strategy.reactions[0]).toEqual({
			when: grainAbove,
			commands: [noop],
		});
	});

	test("a bad command is rejected with its index", () => {
		const message = messageOf({
			name: "s",
			setup: [{ type: "x" }],
			reactions: [],
		});

		expect(message).toStartWith("strategy.setup[0].type:");
	});

	test("a bad condition is rejected with its path", () => {
		const message = messageOf({
			name: "s",
			setup: [],
			reactions: [
				{ when: grainAbove, commands: [] },
				{ when: { kind: "nope" }, commands: [] },
			],
		});

		expect(message).toStartWith("strategy.reactions[1].when");
	});

	test("a chose condition nested inside all is rejected", () => {
		const message = messageOf({
			name: "s",
			setup: [],
			reactions: [
				{
					when: {
						kind: "all",
						conditions: [
							grainAbove,
							{ kind: "chose", decree: "granary", policy: "sell" },
						],
					},
					commands: [],
				},
			],
		});

		expect(message).toBe(
			"strategy.reactions[0].when: chose conditions are not available to strategies",
		);
	});
});

function playerWith(...reactions: Reaction[]) {
	return createStrategyPlayer({ name: "s", setup: [sell], reactions });
}

describe("createStrategyPlayer", () => {
	function observeWith(
		player: ReturnType<typeof playerWith>,
		population: number,
	) {
		const state = createNewGame(1, tuning);
		setRoster(state, { idle: population });
		player.observe(state, tuning);
	}

	test("next hands out the setup first and nothing afterwards when no reaction fires", () => {
		const player = playerWith();

		const first = player.next();
		const second = player.next();

		expect(first).toEqual([sell]);
		expect(second).toEqual([]);
	});

	test("setup commands are copies, not the strategy's own objects", () => {
		const player = playerWith();

		const [handed] = player.next();

		expect(handed).toEqual(sell);
		expect(handed).not.toBe(sell);
	});

	test("a reaction fires once when its condition turns true, not while it stays true", () => {
		const player = playerWith({ when: populationAbove, commands: [noop] });
		player.next();

		observeWith(player, 8);
		const onRise = player.next();
		observeWith(player, 9);
		const whileTrue = player.next();

		expect(onRise).toEqual([noop]);
		expect(whileTrue).toEqual([]);
	});

	test("a reaction fires again after its condition turns false and true", () => {
		const player = playerWith({ when: populationAbove, commands: [noop] });
		player.next();
		observeWith(player, 8);
		player.next();

		observeWith(player, 1);
		const whileFalse = player.next();
		observeWith(player, 8);
		const again = player.next();

		expect(whileFalse).toEqual([]);
		expect(again).toEqual([noop]);
	});

	test("reactions that fire together hand out commands in file order", () => {
		const other: Command = { type: "repealDecree", id: "granary" };
		const player = playerWith(
			{ when: populationAbove, commands: [noop] },
			{ when: populationAbove, commands: [other] },
		);
		player.next();

		observeWith(player, 8);

		expect(player.next()).toEqual([noop, other]);
	});

	test("stats count acting ticks and the longest quiet run", () => {
		const player = playerWith({ when: populationAbove, commands: [noop] });
		const populationAfterStep = [1, 1, 8, 1, 1, 1, 8, 1, 1, 1];
		for (const population of populationAfterStep) {
			player.next();
			observeWith(player, population);
		}

		expect(player.stats()).toEqual({
			setupCommands: 1,
			reactionCommands: 2,
			actingTicks: 2,
			longestQuietTicks: 3,
		});
	});

	test("with no reactions the longest quiet run is the number of steps", () => {
		const player = playerWith();
		for (let step = 0; step < 10; step++) {
			player.next();
			observeWith(player, 8);
		}

		expect(player.stats().longestQuietTicks).toBe(10);
	});
});
