import { describe, expect, test } from "bun:test";
import { formatAmount, formatGameTime, formatRate } from "../src/tui/format";

describe("formatAmount", () => {
	test.each([
		[0, "0.0"],
		[12.34, "12.3"],
		[1234.5, "1,234.5"],
		[999999.9, "999,999.9"],
		[1_234_567, "1.23M"],
		[999_000_000, "999M"],
		[1e9, "1.00B"],
		[45_600_000_000, "45.6B"],
		[1e12, "1.00T"],
		[999.4e12, "999T"],
		[1e15, "1.00e15"],
		[1.23e18, "1.23e18"],
	])("formats %p as %p", (value, expected) => {
		expect(formatAmount(value)).toBe(expected);
	});

	test.each([
		[999_950_000, "1.00B"],
		[999_999.96, "1.00M"],
	])(
		"carries the rounded-up value %p into the next suffix",
		(value, expected) => {
			expect(formatAmount(value)).toBe(expected);
		},
	);

	test("keeps the sign of negative values", () => {
		expect(formatAmount(-1234.5)).toBe("-1,234.5");
		expect(formatAmount(-2_500_000)).toBe("-2.50M");
	});
});

describe("formatRate", () => {
	test.each([
		[15, "+15.0/s"],
		[-2.5, "-2.5/s"],
		[0, "0.0/s"],
		[0.04, "0.0/s"],
		[-0.04, "0.0/s"],
	])(
		"formats %p as %p, with no sign when it rounds to zero",
		(rate, expected) => {
			expect(formatRate(rate)).toBe(expected);
		},
	);
});

describe("formatGameTime", () => {
	test.each([
		[45, "45s"],
		[59.99, "59s"],
		[185, "3m 05s"],
		[7385, "2h 03m 05s"],
		[86400 + 2 * 3600 + 3 * 60 + 5, "1d 02h 03m"],
	])("formats %p seconds as %p", (seconds, expected) => {
		expect(formatGameTime(seconds)).toBe(expected);
	});
});
