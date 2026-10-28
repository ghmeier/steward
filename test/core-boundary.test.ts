import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// Biome enforces most of this too, but lint configs drift; this scan is the backstop the
// determinism guarantee actually rests on.

const coreDir = join(import.meta.dir, "..", "src", "core");

function coreSourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return coreSourceFiles(path);
		return entry.name.endsWith(".ts") ? [path] : [];
	});
}

function stripCommentsAndStrings(source: string): string {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\/\/.*$/gm, "")
		.replace(/`(?:\\[\s\S]|[^`\\])*`/g, '""')
		.replace(/"(?:\\.|[^"\\\n])*"/g, '""')
		.replace(/'(?:\\.|[^'\\\n])*'/g, '""');
}

function importSpecifiers(source: string): string[] {
	const pattern =
		/(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;
	return [...source.matchAll(pattern)].map(
		(match) => match[1] ?? match[2] ?? "",
	);
}

const forbiddenGlobals: Record<string, string> = {
	Date: "time comes from the tick, never the wall clock",
	"Math.random": "draw from a named RNG stream instead",
	performance: "time comes from the tick, never the wall clock",
	setTimeout: "the clock driver outside the core schedules work",
	setInterval: "the clock driver outside the core schedules work",
	process: "the core receives everything it needs as arguments",
	Bun: "the core is runtime-agnostic and does no I/O",
	require: "the core imports only from src/core/",
};

const files = coreSourceFiles(coreDir);

describe("src/core boundary", () => {
	test.each(files.map((file) => [relative(coreDir, file), file]))(
		"%s imports only from src/core/",
		(_name, file) => {
			const source = readFileSync(file, "utf8");

			const outside = importSpecifiers(source).filter((specifier) => {
				if (!specifier.startsWith(".")) return true;
				const resolved = join(file, "..", specifier);
				return relative(coreDir, resolved).startsWith("..");
			});

			expect(outside).toEqual([]);
		},
	);

	test.each(files.map((file) => [relative(coreDir, file), file]))(
		"%s uses no forbidden globals",
		(_name, file) => {
			const code = stripCommentsAndStrings(readFileSync(file, "utf8"));

			const found = Object.entries(forbiddenGlobals)
				.filter(([name]) =>
					new RegExp(
						`(?<![\\w.$])${name.replace(".", "\\s*\\.\\s*")}(?![\\w$])`,
					).test(code),
				)
				.map(([name, why]) => `${name}: ${why}`);

			expect(found).toEqual([]);
		},
	);

	test("the scan finds forbidden imports and globals", () => {
		const code = stripCommentsAndStrings(
			'import { x } from "node:fs";\nconst t = Date.now(); // Math.random\n',
		);

		expect(importSpecifiers('import { x } from "node:fs";')).toEqual([
			"node:fs",
		]);
		expect(/(?<![\w.$])Date(?![\w$])/.test(code)).toBe(true);
		expect(/(?<![\w.$])Math\s*\.\s*random(?![\w$])/.test(code)).toBe(false);
	});
});
