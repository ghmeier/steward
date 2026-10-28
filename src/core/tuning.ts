import { isRecord, sortedKeys } from "./data";
import type { DecreeLimits } from "./decree";
import {
	JOBS,
	type Job,
	RESOURCES,
	type Resource,
	SEASONS,
	type Season,
} from "./realm";

export type Tuning = {
	stepMs: number;
	maxResourceValue: number;
	decrees: DecreeLimits;
	economy: {
		ticksPerSeason: number;
		seasonYield: Record<Season, number>;
		grainPerFarmer: number;
		woodPerWorker: number;
		orePerWorker: number;
		grainPerPerson: number;
		starvationHunger: number;
		grainPrice: number;
		grainPerPeasant: number;
		maxPopulation: number;
		laborMovesPerTick: number;
		initialPopulation: number;
		initialResources: Record<Resource, number>;
		laborAllocations: Record<string, Record<Job, number>>;
	};
};

function field(parent: Record<string, unknown>, path: string, key: string) {
	if (!Object.hasOwn(parent, key)) {
		throw new Error(`tuning.${path}${key} is missing`);
	}
	return parent[key];
}

function finiteNumber(value: unknown, name: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`${name} must be a finite number`);
	}
	return value;
}

function positiveNumber(value: unknown, name: string): number {
	const number = finiteNumber(value, name);
	if (number <= 0) throw new Error(`${name} must be positive`);
	return number;
}

function nonNegativeNumber(value: unknown, name: string): number {
	const number = finiteNumber(value, name);
	if (number < 0) throw new Error(`${name} must not be negative`);
	return number;
}

function integerAtLeast(value: unknown, name: string, minimum: number): number {
	const number = finiteNumber(value, name);
	if (!Number.isInteger(number) || number < minimum) {
		throw new Error(
			`${name} must be ${minimum === 0 ? "a non-negative" : "a positive"} integer`,
		);
	}
	return number;
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!isRecord(value)) throw new Error(`${name} must be an object`);
	return value;
}

function exactKeys(
	value: Record<string, unknown>,
	expected: readonly string[],
	name: string,
): void {
	const actual = sortedKeys(value);
	const wanted = [...expected].sort();
	if (actual.join(",") !== wanted.join(",")) {
		throw new Error(`${name} must have exactly the keys ${wanted.join(", ")}`);
	}
}

function numbersByKey<K extends string>(
	value: unknown,
	keys: readonly K[],
	name: string,
): Record<K, number> {
	const parent = record(value, name);
	exactKeys(parent, keys, name);
	const result = {} as Record<K, number>;
	for (const key of keys) {
		result[key] = nonNegativeNumber(parent[key], `${name}.${key}`);
	}
	return result;
}

function parseAllocations(value: unknown): Record<string, Record<Job, number>> {
	const name = "tuning.economy.laborAllocations";
	const parent = record(value, name);
	const ids = sortedKeys(parent);
	if (ids.length === 0) throw new Error(`${name} must not be empty`);
	const result: Record<string, Record<Job, number>> = {};
	for (const id of ids) {
		const shares = numbersByKey(parent[id], JOBS, `${name}.${id}`);
		let total = 0;
		for (const job of JOBS) total += shares[job];
		if (Math.abs(total - 1) > 1e-9) {
			throw new Error(`${name}.${id} shares must sum to 1`);
		}
		result[id] = shares;
	}
	return result;
}

function parseEconomy(value: unknown): Tuning["economy"] {
	const path = "economy.";
	const economy = record(value, "tuning.economy");
	const get = (key: string) => field(economy, path, key);
	const name = (key: string) => `tuning.economy.${key}`;

	const maxPopulation = integerAtLeast(
		get("maxPopulation"),
		name("maxPopulation"),
		1,
	);
	const initialPopulation = integerAtLeast(
		get("initialPopulation"),
		name("initialPopulation"),
		0,
	);
	if (initialPopulation > maxPopulation) {
		throw new Error(
			"tuning.economy.initialPopulation must not exceed maxPopulation",
		);
	}

	return {
		ticksPerSeason: integerAtLeast(
			get("ticksPerSeason"),
			name("ticksPerSeason"),
			1,
		),
		seasonYield: numbersByKey(get("seasonYield"), SEASONS, name("seasonYield")),
		grainPerFarmer: nonNegativeNumber(
			get("grainPerFarmer"),
			name("grainPerFarmer"),
		),
		woodPerWorker: nonNegativeNumber(
			get("woodPerWorker"),
			name("woodPerWorker"),
		),
		orePerWorker: nonNegativeNumber(get("orePerWorker"), name("orePerWorker")),
		grainPerPerson: nonNegativeNumber(
			get("grainPerPerson"),
			name("grainPerPerson"),
		),
		starvationHunger: positiveNumber(
			get("starvationHunger"),
			name("starvationHunger"),
		),
		grainPrice: nonNegativeNumber(get("grainPrice"), name("grainPrice")),
		grainPerPeasant: positiveNumber(
			get("grainPerPeasant"),
			name("grainPerPeasant"),
		),
		maxPopulation,
		laborMovesPerTick: integerAtLeast(
			get("laborMovesPerTick"),
			name("laborMovesPerTick"),
			1,
		),
		initialPopulation,
		initialResources: numbersByKey(
			get("initialResources"),
			RESOURCES,
			name("initialResources"),
		),
		laborAllocations: parseAllocations(get("laborAllocations")),
	};
}

function parseDecreeLimits(value: unknown): DecreeLimits {
	const limits = record(value, "tuning.decrees");
	const get = (key: string) => field(limits, "decrees.", key);
	const name = (key: string) => `tuning.decrees.${key}`;
	return {
		maxRules: integerAtLeast(get("maxRules"), name("maxRules"), 1),
		maxConditionNodes: integerAtLeast(
			get("maxConditionNodes"),
			name("maxConditionNodes"),
			1,
		),
		maxConditionDepth: integerAtLeast(
			get("maxConditionDepth"),
			name("maxConditionDepth"),
			1,
		),
	};
}

export function parseTuning(value: unknown): Tuning {
	if (!isRecord(value)) throw new Error("tuning must be an object");

	const stepMs = positiveNumber(field(value, "", "stepMs"), "tuning.stepMs");
	const maxResourceValue = positiveNumber(
		field(value, "", "maxResourceValue"),
		"tuning.maxResourceValue",
	);
	const decrees = parseDecreeLimits(field(value, "", "decrees"));
	const economy = parseEconomy(field(value, "", "economy"));
	return { stepMs, maxResourceValue, decrees, economy };
}
