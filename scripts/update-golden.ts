import { writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const goldenPath = join(root, "test", "golden.json");
const seed = 42;
const steps = 10000;
const commands = "test/fixtures/command-log.json";

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
	`${JSON.stringify({ seed, steps, commands, hash: summary.hash }, null, "\t")}\n`,
);
console.log(`wrote ${goldenPath}: ${summary.hash}`);
