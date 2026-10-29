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
		grainPrice: number;
		woodPrice: number;
		orePrice: number;
		grainPerPeasant: number;
		maxPopulation: number;
		laborMovesPerTick: number;
		initialPopulation: number;
		initialResources: Record<Resource, number>;
		laborAllocations: Record<string, Record<Job, number>>;
	};
	village: VillageTuning;
};

export type DisputeOption = {
	id: string;
	label: string;
	resources?: Partial<Record<Resource, number>>;
	grudge?: "first" | "second";
};

export type DisputeTemplate = {
	id: string;
	text: string;
	options: DisputeOption[];
	expiry: string;
};

export type VillageTuning = {
	names: string[];
	deskSlots: number;
	promotionPopulation: number;
	disputeArrival: { minTicks: number; maxTicks: number };
	grudgeTicks: number;
	disputes: DisputeTemplate[];
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
		grainPrice: nonNegativeNumber(get("grainPrice"), name("grainPrice")),
		woodPrice: nonNegativeNumber(get("woodPrice"), name("woodPrice")),
		orePrice: nonNegativeNumber(get("orePrice"), name("orePrice")),
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

function checkPlaceholders(text: string, name: string): void {
	for (const match of text.matchAll(/\{([^{}]*)\}/g)) {
		if (match[1] !== "first" && match[1] !== "second") {
			throw new Error(`${name} has unknown placeholder ${match[0]}`);
		}
	}
}

function parseOption(value: unknown, name: string): DisputeOption {
	const raw = record(value, name);
	const id = raw.id;
	if (typeof id !== "string" || id === "") {
		throw new Error(`${name}.id must be a non-empty string`);
	}
	const label = raw.label;
	if (typeof label !== "string" || label === "") {
		throw new Error(`${name}.label must be a non-empty string`);
	}
	checkPlaceholders(label, `${name}.label`);
	const option: DisputeOption = { id, label };
	if (raw.resources !== undefined) {
		const rawResources = record(raw.resources, `${name}.resources`);
		const resources: Partial<Record<Resource, number>> = {};
		for (const key of sortedKeys(rawResources)) {
			if (!(RESOURCES as readonly string[]).includes(key)) {
				throw new Error(`${name}.resources has unknown resource "${key}"`);
			}
			resources[key as Resource] = finiteNumber(
				rawResources[key],
				`${name}.resources.${key}`,
			);
		}
		option.resources = resources;
	}
	if (raw.grudge !== undefined) {
		if (raw.grudge !== "first" && raw.grudge !== "second") {
			throw new Error(`${name}.grudge must be "first" or "second"`);
		}
		option.grudge = raw.grudge;
	}
	return option;
}

function parseTemplate(value: unknown, name: string): DisputeTemplate {
	const raw = record(value, name);
	const id = raw.id;
	if (typeof id !== "string" || id === "") {
		throw new Error(`${name}.id must be a non-empty string`);
	}
	const text = raw.text;
	if (typeof text !== "string" || text === "") {
		throw new Error(`${name}.text must be a non-empty string`);
	}
	checkPlaceholders(text, `${name}.text`);
	if (!Array.isArray(raw.options) || raw.options.length < 2) {
		throw new Error(`${name}.options must list at least 2 options`);
	}
	const options: DisputeOption[] = [];
	for (const [index, rawOption] of raw.options.entries()) {
		const option = parseOption(rawOption, `${name}.options[${index}]`);
		if (options.some((other) => other.id === option.id)) {
			throw new Error(`${name} repeats option id "${option.id}"`);
		}
		options.push(option);
	}
	const expiry = options.find((option) => option.id === raw.expiry);
	if (expiry === undefined) {
		throw new Error(`${name}.expiry must name one of its options`);
	}
	if (expiry.grudge !== undefined) {
		throw new Error(`${name} expiry option "${expiry.id}" must not grudge`);
	}
	for (const resource of sortedKeys(expiry.resources ?? {})) {
		if ((expiry.resources?.[resource as Resource] ?? 0) > 0) {
			throw new Error(
				`${name} expiry option "${expiry.id}" must not gain ${resource}`,
			);
		}
	}
	return { id, text, options, expiry: expiry.id };
}

function parseDisputes(value: unknown): DisputeTemplate[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error("village.disputes must be a non-empty array");
	}
	const templates: DisputeTemplate[] = [];
	for (const [index, raw] of value.entries()) {
		const template = parseTemplate(raw, `village.disputes[${index}]`);
		if (templates.some((other) => other.id === template.id)) {
			throw new Error(`village.disputes repeats id "${template.id}"`);
		}
		templates.push(template);
	}
	return templates;
}

function promotionPopulation(value: unknown, maxPopulation: number): number {
	const target = integerAtLeast(value, "village.promotionPopulation", 1);
	if (target > maxPopulation) {
		throw new Error(
			`village.promotionPopulation must not exceed economy.maxPopulation (${maxPopulation})`,
		);
	}
	return target;
}

function parseVillage(
	value: unknown,
	maxPopulation: number,
): Tuning["village"] {
	const village = record(value, "village");
	const rawNames = field(village, "village.", "names");
	if (!Array.isArray(rawNames)) {
		throw new Error("village.names must be an array");
	}
	const names: string[] = [];
	const seen = new Set<string>();
	for (const [index, name] of rawNames.entries()) {
		if (typeof name !== "string" || name === "") {
			throw new Error(`village.names[${index}] must be a non-empty string`);
		}
		if (seen.has(name)) throw new Error(`village.names repeats "${name}"`);
		seen.add(name);
		names.push(name);
	}
	if (names.length < maxPopulation) {
		throw new Error(
			`village.names needs at least maxPopulation (${maxPopulation}) names, got ${names.length}`,
		);
	}
	const arrival = record(
		field(village, "village.", "disputeArrival"),
		"village.disputeArrival",
	);
	const minTicks = integerAtLeast(
		field(arrival, "village.disputeArrival.", "minTicks"),
		"village.disputeArrival.minTicks",
		1,
	);
	const maxTicks = integerAtLeast(
		field(arrival, "village.disputeArrival.", "maxTicks"),
		"village.disputeArrival.maxTicks",
		1,
	);
	if (minTicks > maxTicks) {
		throw new Error("village.disputeArrival.minTicks must not exceed maxTicks");
	}
	return {
		names,
		deskSlots: integerAtLeast(
			field(village, "village.", "deskSlots"),
			"village.deskSlots",
			1,
		),
		disputeArrival: { minTicks, maxTicks },
		grudgeTicks: integerAtLeast(
			field(village, "village.", "grudgeTicks"),
			"village.grudgeTicks",
			1,
		),
		promotionPopulation: promotionPopulation(
			field(village, "village.", "promotionPopulation"),
			maxPopulation,
		),
		disputes: parseDisputes(field(village, "village.", "disputes")),
	};
}

/** Takes the merged contents of tuning.json and village.json. */
export function parseTuning(value: unknown): Tuning {
	if (!isRecord(value)) throw new Error("tuning must be an object");

	const stepMs = positiveNumber(field(value, "", "stepMs"), "tuning.stepMs");
	const maxResourceValue = positiveNumber(
		field(value, "", "maxResourceValue"),
		"tuning.maxResourceValue",
	);
	const decrees = parseDecreeLimits(field(value, "", "decrees"));
	const economy = parseEconomy(field(value, "", "economy"));
	const village = parseVillage(
		field(value, "", "village"),
		economy.maxPopulation,
	);
	return { stepMs, maxResourceValue, decrees, economy, village };
}
