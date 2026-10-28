import { isRecord, sortedKeys } from "./data";
import { type Decree, decreeSetProblem, parseDecree } from "./decree";
import { errorMessage } from "./errors";
import { JOBS, RESOURCES } from "./realm";
import { type GameState, SCHEMA_VERSION } from "./state";

function isPlainObject(value: object): boolean {
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function isUint32(value: unknown): boolean {
	return (
		typeof value === "number" &&
		Number.isInteger(value) &&
		value >= 0 &&
		value <= 0xffffffff
	);
}

function describe(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "object") {
		const name = Object.getPrototypeOf(value)?.constructor?.name;
		return typeof name === "string" ? name : "object";
	}
	return typeof value;
}

function scanPlainData(value: unknown, path: string, problems: string[]): void {
	if (value === undefined || value === null) {
		problems.push(`${path}: ${describe(value)} is not allowed`);
	} else if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			problems.push(`${path}: ${value} is not a finite number`);
		} else if (Object.is(value, -0)) {
			problems.push(`${path}: negative zero is not allowed`);
		}
	} else if (typeof value === "string" || typeof value === "boolean") {
		return;
	} else if (Array.isArray(value)) {
		if (Object.getPrototypeOf(value) !== Array.prototype) {
			problems.push(`${path}: array subclass is not plain data`);
		}
		for (let i = 0; i < value.length; i++) {
			if (!Object.hasOwn(value, i)) {
				problems.push(`${path}[${i}]: sparse array hole`);
			} else {
				scanPlainData(value[i], `${path}[${i}]`, problems);
			}
		}
	} else if (typeof value === "object") {
		if (!isPlainObject(value)) {
			problems.push(`${path}: ${describe(value)} is not a plain object`);
			return;
		}
		for (const key of sortedKeys(value)) {
			scanPlainData(
				(value as Record<string, unknown>)[key],
				`${path}.${key}`,
				problems,
			);
		}
	} else {
		problems.push(`${path}: ${typeof value} is not allowed`);
	}
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return isRecord(value) && isPlainObject(value);
}

function isCount(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function checkEconomy(economy: unknown, problems: string[]): void {
	if (!isPlainRecord(economy)) {
		problems.push("$.posting.economy: must be an object");
		return;
	}
	for (const key of ["population", "starved"]) {
		if (!isCount(economy[key])) {
			problems.push(
				`$.posting.economy.${key}: must be a non-negative safe integer`,
			);
		}
	}
	for (const key of ["hunger", "growth"]) {
		const value = economy[key];
		if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
			problems.push(
				`$.posting.economy.${key}: must be a non-negative finite number`,
			);
		}
	}
	const labor = economy.labor;
	if (!isPlainRecord(labor)) {
		problems.push("$.posting.economy.labor: must be an object");
		return;
	}
	if (sortedKeys(labor).join(",") !== JOBS.join(",")) {
		problems.push(
			`$.posting.economy.labor: keys must be exactly ${JOBS.join(", ")}`,
		);
		return;
	}
	let working = 0;
	for (const job of JOBS) {
		const count = labor[job];
		if (!isCount(count)) {
			problems.push(
				`$.posting.economy.labor.${job}: must be a non-negative safe integer`,
			);
		} else {
			working += count;
		}
	}
	if (isCount(economy.population) && working > economy.population) {
		problems.push("$.posting.economy.labor: workers exceed population");
	}
}

// Validation has no tuning, so the size caps are enforced when a decree is enacted, not here.
const UNLIMITED_DECREE = {
	maxRules: Number.MAX_SAFE_INTEGER,
	maxConditionNodes: Number.MAX_SAFE_INTEGER,
	maxConditionDepth: Number.MAX_SAFE_INTEGER,
};

function checkDecrees(decrees: unknown, problems: string[]): void {
	if (!isPlainRecord(decrees)) {
		problems.push("$.posting.decrees: must be an object");
		return;
	}
	const parsed: Record<string, Decree> = {};
	let wellFormed = true;
	for (const key of sortedKeys(decrees)) {
		const path = `$.posting.decrees.${key}`;
		try {
			const decree = parseDecree(decrees[key], UNLIMITED_DECREE);
			if (decree.id === key) parsed[key] = decree;
			else {
				wellFormed = false;
				problems.push(`${path}: id must equal its key`);
			}
		} catch (error) {
			wellFormed = false;
			problems.push(`${path}: ${errorMessage(error)}`);
		}
	}
	if (!wellFormed) return;
	// A set that cannot run must fail at load, not mid-run; labor policies need tuning and are checked only when enacting.
	const problem = decreeSetProblem(parsed, null);
	if (problem !== null) problems.push(`$.posting.decrees: ${problem}`);
}

function checkStructure(state: unknown, problems: string[]): void {
	if (!isPlainRecord(state)) {
		problems.push("$: must be an object");
		return;
	}
	if (state.schemaVersion !== SCHEMA_VERSION) {
		problems.push(`$.schemaVersion: must be ${SCHEMA_VERSION}`);
	}
	const tick = state.tick;
	if (typeof tick !== "number" || !Number.isSafeInteger(tick) || tick < 0) {
		problems.push("$.tick: must be a non-negative safe integer");
	}

	const career = state.career;
	if (!isPlainRecord(career)) {
		problems.push("$.career: must be an object");
	} else {
		for (const key of ["unlocks", "savedDecrees"]) {
			if (!isPlainRecord(career[key])) {
				problems.push(`$.career.${key}: must be an object`);
			}
		}
		for (const key of ["followers", "formerStaff"]) {
			if (!Array.isArray(career[key])) {
				problems.push(`$.career.${key}: must be an array`);
			}
		}
	}

	const posting = state.posting;
	if (!isPlainRecord(posting)) {
		problems.push("$.posting: must be an object");
		return;
	}
	if (typeof posting.postingId !== "string") {
		problems.push("$.posting.postingId: must be a string");
	}
	if (!isUint32(posting.seed)) {
		problems.push("$.posting.seed: must be a uint32");
	}

	const rng = posting.rng;
	if (!isPlainRecord(rng)) {
		problems.push("$.posting.rng: must be an object");
	} else {
		for (const name of sortedKeys(rng)) {
			const words = rng[name];
			const path = `$.posting.rng.${name}`;
			if (!Array.isArray(words) || words.length !== 4) {
				problems.push(`${path}: must be an array of 4 uint32 words`);
			} else if (!words.every(isUint32)) {
				problems.push(`${path}: every word must be a uint32`);
			} else if (words.every((word) => word === 0)) {
				problems.push(`${path}: must not be all zero`);
			}
		}
	}

	const resources = posting.resources;
	if (!isPlainRecord(resources)) {
		problems.push("$.posting.resources: must be an object");
	} else {
		for (const id of RESOURCES) {
			if (!Object.hasOwn(resources, id)) {
				problems.push(`$.posting.resources.${id}: is missing`);
			}
		}
		for (const id of sortedKeys(resources)) {
			const amount = resources[id];
			if (typeof amount !== "number" || !Number.isFinite(amount)) {
				problems.push(`$.posting.resources.${id}: must be a finite number`);
			}
		}
	}

	checkEconomy(posting.economy, problems);
	checkDecrees(posting.decrees, problems);
}

export function validateState(state: unknown): string[] {
	const problems: string[] = [];
	scanPlainData(state, "$", problems);
	checkStructure(state, problems);
	return problems;
}

export function assertValidState(state: unknown): asserts state is GameState {
	const problems = validateState(state);
	if (problems.length > 0) {
		throw new Error(`invalid game state:\n${problems.join("\n")}`);
	}
}
