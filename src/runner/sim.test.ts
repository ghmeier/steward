import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tuning } from "../../test/helpers";
import { runSim } from "./sim";

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

function logFile(peasant: number, job: string, tick: number): string {
  const path = join(mkdtempSync(join(tmpdir(), "steward-sim-")), "log.json");
  const command = { type: "assignPeasant", peasant, job };
  writeFileSync(path, JSON.stringify([{ tick, command }]));
  return path;
}

const base = ["--seed", "1", "--steps", "1"];

describe("runSim argument errors", () => {
  // biome-ignore format: one row per case
  const rows: [string, string[]][] = [
		["both --seed and --load", ["--seed", "1", "--load", "x.json", "--steps", "1"]],
		["neither --seed nor --load", ["--steps", "1"]],
		["missing --steps", ["--seed", "1"]],
		["negative --steps", ["--seed", "1", "--steps=-1"]],
		["seed above uint32", ["--seed", "4294967296", "--steps", "1"]],
		["zero --trace", [...base, "--trace", "0"]],
		["unknown flag", [...base, "--bogus"]],
		["--strategy with --commands", [...base, "--strategy", "s.json", "--commands", "c.json"]],
		["--record without --strategy", [...base, "--record", "r.json"]],
		["--grant with --load", ["--load", "s.json", "--steps", "1", "--grant", "decree.compound"]],
	];

  test.each(rows)("%s exits with code 2 and a usage message", (_name, argv) => {
    const { code, stdout, stderr } = run(argv);

    expect(code).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr.join("\n")).toContain("usage:");
  });
});

describe("runSim illusion commands", () => {
  const commands = [
    { type: "conjure", resource: "coin", amount: 5 },
    { type: "forge" },
    { type: "back", resource: "grain" },
  ];

  test("conjure, forge and back parse, and are rejected with a reason before the unlock", () => {
    const path = join(mkdtempSync(join(tmpdir(), "steward-sim-")), "log.json");
    writeFileSync(
      path,
      JSON.stringify(commands.map((command) => ({ tick: 1, command }))),
    );

    const { code, stdout } = run([...base, "--commands", path]);
    const summary = JSON.parse(stdout.at(-1) as string);

    expect(code).toBe(0);
    expect(
      summary.rejectedCommands.map((c: { type: string }) => c.type),
    ).toEqual(["conjure", "forge", "back"]);
    expect(summary.illusion).toEqual({ conjured: 0, debt: 0, peakDebt: 0 });
  });
});

describe("runSim --grant", () => {
  test("writing the unlock at tick 0 changes the final state", () => {
    const plain = run(base);
    const granted = run([...base, "--grant", "decree.compound"]);

    expect(granted.code).toBe(0);
    expect(JSON.parse(granted.stdout.at(-1) as string).hash).not.toBe(
      JSON.parse(plain.stdout.at(-1) as string).hash,
    );
  });

  test("an unknown unlock id fails with an error naming it", () => {
    const { code, stderr } = run([...base, "--grant", "decree.nothing"]);

    expect(code).toBe(1);
    expect(stderr.join("\n")).toContain("decree.nothing");
  });
});

describe("runSim output", () => {
  test("--trace 1000 over 10,000 steps prints 10 trace lines then a summary with the lowest population seen", () => {
    const { code, stdout } = run([
      "--seed",
      "42",
      "--steps",
      "10000",
      "--trace",
      "1000",
    ]);

    const objects = stdout.map(
      (line) => JSON.parse(line) as Record<string, number | string>,
    );
    expect(code).toBe(0);
    expect(objects.slice(0, 10).every((o) => o.type === "trace")).toBe(true);
    expect(objects).toHaveLength(11);
    expect(objects[10]?.type).toBe("summary");
    expect(objects[10]?.minPopulation).toBe(tuning.economy.initialPopulation);
  });

  test("rejected commands are reported with their tick and type", () => {
    const { code, stdout } = run([
      "--seed",
      "1",
      "--steps",
      "3",
      "--commands",
      logFile(999, "farm", 2),
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

  test("a state that fails validation exits with code 1 and names the failing tick", () => {
    // With no cap, one forester at 1e308 per tick overflows to Infinity on the second tick.
    const overflowing = {
      ...tuning,
      maxResourceValue: Number.POSITIVE_INFINITY,
      economy: { ...tuning.economy, woodPerWorker: 1e308 },
    };

    const { code, stdout, stderr } = run(
      ["--seed", "1", "--steps", "10", "--commands", logFile(1, "forest", 1)],
      { tuning: overflowing },
    );

    const error = JSON.parse(stderr[0] as string) as {
      tick: number;
      message: string;
    };
    expect(code).toBe(1);
    expect(stdout).toEqual([]);
    expect(error.tick).toBe(2);
    expect(error.message).toContain("tick 2");
  });
});
