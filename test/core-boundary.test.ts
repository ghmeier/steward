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

const bannedMathMembers = [
  "pow",
  "log",
  "log2",
  "log10",
  "log1p",
  "exp",
  "expm1",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "sinh",
  "cosh",
  "tanh",
  "asinh",
  "acosh",
  "atanh",
  "cbrt",
  "hypot",
];

function bannedMathReason(member: string): string {
  return member === "pow"
    ? "use powInt from src/core/math.ts"
    : "implementation-defined results break replay determinism";
}

function findBannedMath(code: string): string[] {
  return bannedMathMembers
    .filter((member) =>
      new RegExp(`(?<![\\w.$])Math\\s*\\.\\s*${member}(?![\\w$])`).test(code),
    )
    .map((member) => `Math.${member}: ${bannedMathReason(member)}`);
}

function findExponentOperator(code: string): string[] {
  return /\*\*/.test(code) ? ["**: use powInt from src/core/math.ts"] : [];
}

// Matches `resources[id] += x`, `resources.food -= 1` and `a.b.resources["x"] += 1`
// (strings are already stripped to "" by the time this runs).
function findDirectResourceMutation(code: string): string[] {
  return /(?<![\w$])resources\s*(?:\.\s*[\w$]+|\[[^\]]*\])\s*[+-]=(?!=)/.test(
    code,
  )
    ? ["+=/-= on a resource: use add() so absorbed additions are recorded"]
    : [];
}

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

  test.each(files.map((file) => [relative(coreDir, file), file]))(
    "%s uses no banned Math members",
    (_name, file) => {
      const code = stripCommentsAndStrings(readFileSync(file, "utf8"));

      expect(findBannedMath(code)).toEqual([]);
    },
  );

  test.each(files.map((file) => [relative(coreDir, file), file]))(
    "%s does not use the ** operator",
    (_name, file) => {
      const code = stripCommentsAndStrings(readFileSync(file, "utf8"));

      expect(findExponentOperator(code)).toEqual([]);
    },
  );

  test.each(files.map((file) => [relative(coreDir, file), file]))(
    "%s changes resources only through add()",
    (_name, file) => {
      const code = stripCommentsAndStrings(readFileSync(file, "utf8"));

      expect(findDirectResourceMutation(code)).toEqual([]);
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

  test("the math scan catches banned members and names powInt for pow", () => {
    for (const member of bannedMathMembers) {
      const code = stripCommentsAndStrings(`const x = Math.${member}(2, 3);`);

      expect(findBannedMath(code)).toHaveLength(1);
    }
    const powCode = stripCommentsAndStrings("Math.pow(2, 3)");

    expect(findBannedMath(powCode)[0]).toContain("powInt");
  });

  test("the math scan ignores banned members in comments and strings", () => {
    const code = stripCommentsAndStrings(
      '// Math.pow(2, 3)\n/* Math.log(1) */\nconst s = "Math.exp(1)";\nMath.floor(1.5); Math.max(1, 2);',
    );

    expect(findBannedMath(code)).toEqual([]);
  });

  test("the exponent scan catches ** and **= but ignores comments and strings", () => {
    const caught = ["const x = a ** 2;", "x **= 2;"].map(
      (sample) => findExponentOperator(stripCommentsAndStrings(sample)).length,
    );
    const ignored = stripCommentsAndStrings(
      '/** doc */\n// a ** b\nconst s = "a ** b";\nconst y = a * b;',
    );

    expect(caught).toEqual([1, 1]);
    expect(findExponentOperator(ignored)).toEqual([]);
    expect(
      findExponentOperator(stripCommentsAndStrings("x ** 2"))[0],
    ).toContain("powInt");
  });

  test("the resource scan catches direct += and -= but ignores comments and strings", () => {
    const samples = [
      "resources[id] += x;",
      "resources.food -= 1;",
      'state.posting.resources["x"] += 1;',
    ];
    const ignored = stripCommentsAndStrings(
      '// resources.food += 1\nconst s = "resources.food += 1";\nresources[id] = 5;\nif (resources.food >= 1) {}',
    );

    for (const sample of samples) {
      expect(
        findDirectResourceMutation(stripCommentsAndStrings(sample)),
      ).toEqual([
        "+=/-= on a resource: use add() so absorbed additions are recorded",
      ]);
    }
    expect(findDirectResourceMutation(ignored)).toEqual([]);
  });
});
