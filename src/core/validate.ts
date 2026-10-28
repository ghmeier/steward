import { isRecord, sortedKeys } from "./data";
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
		for (const id of sortedKeys(resources)) {
			const amount = resources[id];
			if (typeof amount !== "number" || !Number.isFinite(amount)) {
				problems.push(`$.posting.resources.${id}: must be a finite number`);
			}
		}
	}

	const toy = posting.toy;
	if (!isPlainRecord(toy)) {
		problems.push("$.posting.toy: must be an object");
	} else if (
		typeof toy.growthPerTick !== "number" ||
		!Number.isFinite(toy.growthPerTick)
	) {
		problems.push("$.posting.toy.growthPerTick: must be a finite number");
	}
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
