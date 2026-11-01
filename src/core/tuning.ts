import { isRecord, sortedKeys } from "./data";
import { type Condition, type DecreeLimits, parseCondition } from "./decree";
import {
	JOBS,
	type Job,
	RESOURCES,
	type Resource,
	SEASONS,
	type Season,
} from "./realm";
import {
	ARCHIVE_PANEL,
	type ArchiveEntry,
	type ArchiveTuning,
	CHAINING_UNLOCK,
	COMPOUND_UNLOCK,
	type NeedHook,
	type PlayUnlock,
} from "./unlocks";

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
	archive: ArchiveTuning;
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

function nonEmptyString(value: unknown, name: string): string {
	if (typeof value !== "string" || value === "") {
		throw new Error(`${name} must be a non-empty string`);
	}
	return value;
}

function parseSimpleCondition(value: unknown, name: string): Condition {
	const condition = parseCondition(
		value,
		{ maxRules: 1, maxConditionNodes: 8, maxConditionDepth: 3 },
		name,
	);
	if (condition.kind !== "compare" && condition.kind !== "season") {
		throw new Error(`${name} must be a compare or season condition`);
	}
	return condition;
}

function arrayOf(value: unknown, name: string): unknown[] {
	if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
	return value;
}

function parseEntries(value: unknown): ArchiveEntry[] {
	const entries: ArchiveEntry[] = [];
	for (const [index, item] of arrayOf(value, "archive.entries").entries()) {
		const name = `archive.entries[${index}]`;
		const raw = record(item, name);
		const requires = arrayOf(raw.requires, `${name}.requires`).map(
			(required, at) => nonEmptyString(required, `${name}.requires[${at}]`),
		);
		entries.push({
			id: nonEmptyString(raw.id, `${name}.id`),
			label: nonEmptyString(raw.label, `${name}.label`),
			description: nonEmptyString(raw.description, `${name}.description`),
			cost: positiveNumber(raw.cost, `${name}.cost`),
			requires,
		});
	}
	return entries;
}

function parsePlay(value: unknown): PlayUnlock[] {
	return arrayOf(value, "archive.play").map((item, index) => {
		const name = `archive.play[${index}]`;
		const raw = record(item, name);
		return {
			id: nonEmptyString(raw.id, `${name}.id`),
			label: nonEmptyString(raw.label, `${name}.label`),
			when: parseSimpleCondition(raw.when, `${name}.when`),
		};
	});
}

function parseNeeds(value: unknown): NeedHook[] {
	return arrayOf(value, "archive.needs").map((item, index) => {
		const name = `archive.needs[${index}]`;
		const raw = record(item, name);
		return {
			control: nonEmptyString(raw.control, `${name}.control`),
			when: parseSimpleCondition(raw.when, `${name}.when`),
		};
	});
}

function checkRequiredIds(entries: ArchiveEntry[], play: PlayUnlock[]): void {
	for (const id of [COMPOUND_UNLOCK, CHAINING_UNLOCK]) {
		if (!entries.some((entry) => entry.id === id)) {
			throw new Error(`archive.entries must include "${id}"`);
		}
	}
	if (!play.some((unlock) => unlock.id === ARCHIVE_PANEL)) {
		throw new Error(`archive.play must include "${ARCHIVE_PANEL}"`);
	}
}

function checkEntryGraph(entries: ArchiveEntry[], play: PlayUnlock[]): void {
	const ids = new Set<string>();
	for (const id of [
		...entries.map((entry) => entry.id),
		...play.map((unlock) => unlock.id),
	]) {
		if (ids.has(id)) throw new Error(`archive repeats id "${id}"`);
		ids.add(id);
	}
	const byId = new Map(entries.map((entry) => [entry.id, entry]));
	for (const entry of entries) {
		for (const required of entry.requires) {
			if (!byId.has(required)) {
				throw new Error(
					`archive entry "${entry.id}" requires unknown id "${required}"`,
				);
			}
		}
	}
	const done = new Set<string>();
	const visit = (id: string, path: string[]): void => {
		if (path.includes(id)) {
			throw new Error(`archive requires cycle: ${[...path, id].join(" -> ")}`);
		}
		if (done.has(id)) return;
		for (const required of byId.get(id)?.requires ?? []) {
			visit(required, [...path, id]);
		}
		done.add(id);
	};
	for (const entry of entries) visit(entry.id, []);
}

function parseArchive(value: unknown): ArchiveTuning {
	const archive = record(value, "tuning.archive");
	const entries = parseEntries(field(archive, "archive.", "entries"));
	const play = parsePlay(field(archive, "archive.", "play"));
	const needs = parseNeeds(field(archive, "archive.", "needs"));
	checkRequiredIds(entries, play);
	checkEntryGraph(entries, play);
	const controls = new Set<string>();
	for (const hook of needs) {
		if (controls.has(hook.control)) {
			throw new Error(`archive.needs repeats control "${hook.control}"`);
		}
		controls.add(hook.control);
	}
	return {
		maxSaved: integerAtLeast(
			field(archive, "archive.", "maxSaved"),
			"tuning.archive.maxSaved",
			1,
		),
		entries,
		play,
		needs,
	};
}

/** Takes the merged contents of tuning.json, village.json and archive.json. */
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
	const archive = parseArchive(field(value, "", "archive"));
	return { stepMs, maxResourceValue, decrees, economy, village, archive };
}
