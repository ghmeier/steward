import { describe, expect, test } from "bun:test";
import { formatAmount, formatGameTime, formatRate } from "../src/tui/format";

describe("formatAmount", () => {
	test("shows one decimal place below a million", () => {
		expect(formatAmount(0)).toBe("0.0");
		expect(formatAmount(12.34)).toBe("12.3");
	});

	test("separates thousands with commas", () => {
		expect(formatAmount(1234.5)).toBe("1,234.5");
		expect(formatAmount(999999.9)).toBe("999,999.9");
	});

	test("switches to a suffix at each power of a thousand from one million", () => {
		expect(formatAmount(1_000_000)).toBe("1.00M");
		expect(formatAmount(1_234_567)).toBe("1.23M");
		expect(formatAmount(999_000_000)).toBe("999M");
		expect(formatAmount(1e9)).toBe("1.00B");
		expect(formatAmount(45_600_000_000)).toBe("45.6B");
		expect(formatAmount(1e12)).toBe("1.00T");
		expect(formatAmount(789e12)).toBe("789T");
	});

	test("stays on the current suffix just below the next boundary", () => {
		expect(formatAmount(999e9)).toBe("999B");
		expect(formatAmount(999.4e12)).toBe("999T");
	});

	test("carries a rounded-up value into the next suffix", () => {
		expect(formatAmount(999_950_000)).toBe("1.00B");
		expect(formatAmount(999_999.96)).toBe("1.00M");
	});

	test("uses exponent form from 1e15", () => {
		expect(formatAmount(1e15)).toBe("1.00e15");
		expect(formatAmount(1.23e18)).toBe("1.23e18");
	});

	test("keeps the sign of negative values", () => {
		expect(formatAmount(-1234.5)).toBe("-1,234.5");
		expect(formatAmount(-2_500_000)).toBe("-2.50M");
	});
});

describe("formatRate", () => {
	test("prefixes positive rates with a plus sign", () => {
		expect(formatRate(15)).toBe("+15.0/s");
	});

	test("prefixes negative rates with a minus sign", () => {
		expect(formatRate(-2.5)).toBe("-2.5/s");
	});

	test("shows zero without a sign", () => {
		expect(formatRate(0)).toBe("0.0/s");
	});

	test("shows rates that round to zero without a sign", () => {
		expect(formatRate(0.04)).toBe("0.0/s");
		expect(formatRate(-0.04)).toBe("0.0/s");
	});
});

describe("formatGameTime", () => {
	test("shows only seconds under a minute", () => {
		expect(formatGameTime(45)).toBe("45s");
	});

	test("zero-pads seconds once minutes appear", () => {
		expect(formatGameTime(185)).toBe("3m 05s");
	});

	test("shows hours with zero-padded minutes and seconds", () => {
		expect(formatGameTime(7385)).toBe("2h 03m 05s");
	});

	test("drops seconds once days appear", () => {
		expect(formatGameTime(86400 + 2 * 3600 + 3 * 60 + 5)).toBe("1d 02h 03m");
	});

	test("floors fractional seconds", () => {
		expect(formatGameTime(59.99)).toBe("59s");
	});
});
