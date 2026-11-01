import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSim } from "../src/runner/sim";
import { tuning } from "./helpers";

function run(argv: string[], dependencies = {}) {
	const stdout: string[] = [];
	const stderr: string[] = [];
	const code = runSim(
		argv,
		{ stdout: (l) => stdout.push(l), stderr: (l) => stderr.push(l) },
		dependencies,
	);
	return { code, stdout, stderr };
}

describe("runSim argument errors", () => {
	test.each([
		[
			"both --seed and --load",
			["--seed", "1", "--load", "x.json", "--steps", "1"],
		],
		["neither --seed nor --load", ["--steps", "1"]],
		["missing --steps", ["--seed", "1"]],
		["negative --steps", ["--seed", "1", "--steps=-1"]],
		["fractional --steps", ["--seed", "1", "--steps", "1.5"]],
		["seed above uint32", ["--seed", "4294967296", "--steps", "1"]],
		["zero --trace", ["--seed", "1", "--steps", "1", "--trace", "0"]],
		["unknown flag", ["--seed", "1", "--steps", "1", "--bogus"]],
		[
			"--strategy with --commands",
			[
				"--seed",
				"1",
				"--steps",
				"1",
				"--strategy",
				"s.json",
				"--commands",
				"c.json",
			],
		],
		[
			"--record without --strategy",
			["--seed", "1", "--steps", "1", "--record", "r.json"],
		],
		[
			"--grant with --load",
			["--load", "s.json", "--steps", "1", "--grant", "decree.compound"],
		],
	])("%s exits with code 2 and a usage message", (_name, argv) => {
		const { code, stdout, stderr } = run(argv);

		expect(code).toBe(2);
		expect(stdout).toEqual([]);
		expect(stderr.join("\n")).toContain("usage:");
	});
});

describe("runSim --grant", () => {
	test("changes the final state by writing the unlock at tick 0", () => {
		const base = ["--seed", "1", "--steps", "1"];

		const plain = run(base);
		const granted = run([...base, "--grant", "decree.compound"]);

		expect(granted.code).toBe(0);
		expect(JSON.parse(granted.stdout.at(-1) as string).hash).not.toBe(
			JSON.parse(plain.stdout.at(-1) as string).hash,
		);
	});

	test("an unknown unlock id fails with an error naming it", () => {
		const { code, stderr } = run([
			"--seed",
			"1",
			"--steps",
			"1",
			"--grant",
			"decree.nothing",
		]);

		expect(code).toBe(1);
		expect(stderr.join("\n")).toContain("decree.nothing");
	});
});

describe("runSim output", () => {
	test("--trace 1000 over 10,000 steps prints 10 trace lines then one summary", () => {
		const { code, stdout } = run([
			"--seed",
			"42",
			"--steps",
			"10000",
			"--trace",
			"1000",
		]);

		const objects = stdout.map((line) => JSON.parse(line) as { type: string });
		expect(code).toBe(0);
		expect(objects).toHaveLength(11);
		expect(objects.slice(0, 10).every((o) => o.type === "trace")).toBe(true);
		expect(objects[10]?.type).toBe("summary");
	});

	test("the summary reports the lowest population seen, including the start", () => {
		const { stdout } = run(["--seed", "1", "--steps", "5"]);

		const summary = JSON.parse(stdout[0] as string) as {
			minPopulation: number;
			population: number;
		};
		expect(summary.minPopulation).toBe(tuning.economy.initialPopulation);
		expect(summary.minPopulation).toBeLessThanOrEqual(summary.population);
	});

	test("rejected commands are reported with their tick, type and reason", () => {
		const { code, stdout } = run([
			"--seed",
			"1",
			"--steps",
			"3",
			"--commands",
			rejectingLog(),
		]);

		const summary = JSON.parse(stdout[0] as string) as {
			rejectedCommands: { tick: number; type: string; reason: string }[];
		};
		expect(code).toBe(0);
		expect(summary.rejectedCommands).toHaveLength(1);
		expect(summary.rejectedCommands[0]).toMatchObject({
			tick: 2,
			type: "assignPeasant",
		});
	});
});

describe("runSim validation failure", () => {
	test("exits with code 1 and names the failing tick", () => {
		// With no cap, one forester at 1e308 per tick overflows to Infinity on the second tick.
		const overflowing = {
			...tuning,
			maxResourceValue: Number.POSITIVE_INFINITY,
			economy: { ...tuning.economy, woodPerWorker: 1e308 },
		};

		const { code, stdout, stderr } = run(
			["--seed", "1", "--steps", "10", "--commands", foresterLog()],
			{ tuning: overflowing },
		);

		const error = JSON.parse(stderr[0] as string) as {
			type: string;
			tick: number;
			message: string;
		};
		expect(code).toBe(1);
		expect(stdout).toEqual([]);
		expect(error.type).toBe("error");
		expect(error.tick).toBe(2);
		expect(error.message).toContain("tick 2");
	});
});

function foresterLog(): string {
	const path = join(mkdtempSync(join(tmpdir(), "steward-sim-")), "log.json");
	writeFileSync(
		path,
		JSON.stringify([
			{
				tick: 1,
				command: { type: "assignPeasant", peasant: 1, job: "forest" },
			},
		]),
	);
	return path;
}

function rejectingLog(): string {
	const path = join(mkdtempSync(join(tmpdir(), "steward-sim-")), "log.json");
	writeFileSync(
		path,
		JSON.stringify([
			{
				tick: 2,
				command: { type: "assignPeasant", peasant: 999, job: "farm" },
			},
		]),
	);
	return path;
}
