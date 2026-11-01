import { describe, expect, test } from "bun:test";
import {
	array,
	custom,
	integer,
	keyedBy,
	literal,
	number,
	object,
	parse,
	problemsOf,
	record,
	refine,
	type Schema,
	string,
} from "../src/core/schema";

const point = object({ x: number(), y: number() });

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
