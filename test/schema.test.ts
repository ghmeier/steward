import { describe, expect, test } from "bun:test";
import {
	array,
	custom,
	integer,
	keyedBy,
	lazy,
	literal,
	number,
	object,
	parse,
	problemsOf,
	record,
	refine,
	type Schema,
	string,
	tuple,
	variant,
} from "../src/core/schema";

const point = object({ x: number(), y: number() });
const shape = variant("kind", {
	dot: object({ kind: literal("dot"), at: point }),
	line: object({ kind: literal("line"), length: number() }),
});
type Nest = { child?: Nest };
const nest: Schema<Nest> = lazy(() =>
	object({ child: nest }, { optional: ["child"] }),
);
const nested = (levels: number): Nest =>
	levels === 0 ? {} : { child: nested(levels - 1) };

const accepts: [string, Schema<unknown>, unknown][] = [
	["an integer within bounds", integer({ min: 1, max: 3 }), 3],
	["a number above an exclusive minimum", number({ exclusiveMin: 0 }), 0.1],
	[
		"a non-empty string matching a pattern",
		string({ nonEmpty: true, pattern: /^a/ }),
		"ab",
	],
	["a listed literal", literal("first", "second"), "second"],
	["an array at its minimum length", array(integer(), { minLength: 1 }), [1]],
	["an object with exact keys", point, { x: 1, y: 2 }],
	["a record in any key order", record(integer()), { b: 1, a: 2 }],
	[
		"a record keyed by a tuple",
		keyedBy(["a", "b"] as const, integer()),
		{ a: 1, b: 2 },
	],
	["a tuple of the exact length", tuple(integer(), string()), [1, "a"]],
	["a variant routed by its tag", shape, { kind: "line", length: 2 }],
	["a recursive schema within the depth guard", nest, nested(10)],
	["a custom parser that returns", custom((value) => value), "anything"],
];

const rejects: [string, Schema<unknown>, unknown, string][] = [
	["a fractional integer", integer(), 1.5, "t: must be an integer"],
	["an integer below its minimum", integer({ min: 1 }), 0, "t:"],
	["an infinite number", number(), Number.POSITIVE_INFINITY, "t:"],
	["a number at an exclusive minimum", number({ exclusiveMin: 0 }), 0, "t:"],
	["a negative number below a minimum", number({ min: 0 }), -1, "t:"],
	["an empty string", string({ nonEmpty: true }), "", "t:"],
	["a string failing its pattern", string({ pattern: /^a/ }), "b", "t:"],
	["an unlisted literal", literal("first"), "third", "t:"],
	["a short array", array(integer(), { minLength: 2 }), [1], "t:"],
	["a bad array item", array(integer()), [1, 2, "x"], "t[2]:"],
	["an unknown object key", point, { x: 1, y: 2, z: 3 }, "t.z:"],
	["a missing object key", point, { x: 1 }, "t.y:"],
	["a bad record value", record(integer()), { a: 1, b: "x" }, "t.b:"],
	[
		"a keyed record missing a key",
		keyedBy(["a", "b"] as const, integer()),
		{ a: 1 },
		"t.b:",
	],
	[
		"a keyed record with a stray key",
		keyedBy(["a"] as const, integer()),
		{ a: 1, c: 1 },
		"t.c:",
	],
	["an integer beyond the safe range", integer(), 2 ** 53, "t:"],
	["a tuple of the wrong length", tuple(integer(), integer()), [1], "t:"],
	["a variant given a non-object", shape, 4, "t: must be an object"],
	["a variant without its tag", shape, { length: 1 }, "t.kind: is missing"],
	["a variant with an unknown tag", shape, { kind: "arc" }, "t.kind:"],
	[
		"a variant body that fails its tag's schema",
		shape,
		{ kind: "dot", at: { x: 1 } },
		"t.at.y: is missing",
	],
	[
		"a custom parser that throws",
		custom(() => {
			throw new Error("nope");
		}),
		1,
		"t: nope",
	],
];

describe("schema", () => {
	test.each(accepts)("accepts %s", (_name, schema, value) => {
		expect(parse(schema, value, "t")).toEqual(value);
	});

	test.each(rejects)("rejects %s", (_name, schema, value, expected) => {
		expect(problemsOf(schema, value, "t")[0]).toStartWith(expected);
	});

	test("object omits absent optional keys instead of setting them to undefined", () => {
		const schema = object({ a: integer(), b: integer() }, { optional: ["b"] });

		const result = parse(schema, { a: 1 }, "t");

		expect(Object.hasOwn(result, "b")).toBe(false);
	});

	test("number turns negative zero into zero", () => {
		expect(Object.is(parse(number(), -0, "t"), 0)).toBe(true);
	});

	test("a nesting-depth rejection stops the recursion with one problem", () => {
		const problems = problemsOf(nest, nested(10_000), "t");

		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain("nests deeper than");
	});

	test("refine does not run after a shape problem and does run after a clean parse", () => {
		let runs = 0;
		const schema = refine(point, () => {
			runs++;
		});

		problemsOf(schema, { x: 1 }, "t");
		expect(runs).toBe(0);

		problemsOf(schema, { x: 1, y: 2 }, "t");
		expect(runs).toBe(1);
	});

	test("parse output shares no objects with its input", () => {
		const schema = object({ list: array(point), map: record(point) });
		const input = { list: [{ x: 1, y: 2 }], map: { k: { x: 3, y: 4 } } };

		const output = parse(schema, input, "t");

		expect(output).toEqual(input);
		expect(output).not.toBe(input);
		expect(output.list).not.toBe(input.list);
		expect(output.list[0]).not.toBe(input.list[0]);
		expect(output.map.k).not.toBe(input.map.k);
	});

	test("problemsOf reports every problem and parse joins them in one error", () => {
		const input = { x: "a", y: "b", z: 1 };

		const problems = problemsOf(point, input, "t");

		expect(problems).toHaveLength(3);
		expect(() => parse(point, input, "t")).toThrow(problems.join("; "));
	});
});
