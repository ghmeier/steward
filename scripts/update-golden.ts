import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const goldenPath = join(root, "test", "golden.json");
const seed = 42;
const steps = 10000;
const commands = "test/fixtures/command-log.json";
const grant = (
	JSON.parse(readFileSync(join(root, "data", "archive.json"), "utf8")) as {
		entries: { id: string }[];
	}
).entries.map((entry) => entry.id);

const result = Bun.spawnSync(
	[
		"bun",
		"src/runner/sim.ts",
		"--seed",
		String(seed),
		"--steps",
		String(steps),
		"--commands",
		commands,
		"--grant",
		grant.join(","),
	],
	{ cwd: root },
);
if (result.exitCode !== 0) {
	console.error(result.stderr.toString());
	process.exit(result.exitCode ?? 1);
}
const summary = JSON.parse(result.stdout.toString().trim()) as {
	hash: string;
};
writeFileSync(
	goldenPath,
	`${JSON.stringify({ seed, steps, commands, grant, hash: summary.hash }, null, "\t")}\n`,
);
console.log(`wrote ${goldenPath}: ${summary.hash}`);
