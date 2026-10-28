export type Tuning = {
	stepMs: number;
	maxResourceValue: number;
	toy: {
		resource: string;
		initialGrowthPerTick: number;
		lossChancePerMille: number;
		maxLoss: number;
	};
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

export function parseTuning(value: unknown): Tuning {
	if (!isRecord(value)) throw new Error("tuning must be an object");
	const toy = field(value, "", "toy");
	if (!isRecord(toy)) throw new Error("tuning.toy must be an object");

	const stepMs = positiveNumber(field(value, "", "stepMs"), "tuning.stepMs");
	const maxResourceValue = positiveNumber(
		field(value, "", "maxResourceValue"),
		"tuning.maxResourceValue",
	);

	const resource = field(toy, "toy.", "resource");
	if (typeof resource !== "string" || resource === "") {
		throw new Error("tuning.toy.resource must be a non-empty string");
	}
	const initialGrowthPerTick = finiteNumber(
		field(toy, "toy.", "initialGrowthPerTick"),
		"tuning.toy.initialGrowthPerTick",
	);
	const lossChancePerMille = finiteNumber(
		field(toy, "toy.", "lossChancePerMille"),
		"tuning.toy.lossChancePerMille",
	);
	if (
		!Number.isInteger(lossChancePerMille) ||
		lossChancePerMille < 0 ||
		lossChancePerMille > 1000
	) {
		throw new Error(
			"tuning.toy.lossChancePerMille must be an integer from 0 to 1000",
		);
	}
	const maxLoss = finiteNumber(
		field(toy, "toy.", "maxLoss"),
		"tuning.toy.maxLoss",
	);
	if (!Number.isInteger(maxLoss) || maxLoss <= 0) {
		throw new Error("tuning.toy.maxLoss must be a positive integer");
	}

	return {
		stepMs,
		maxResourceValue,
		toy: { resource, initialGrowthPerTick, lossChancePerMille, maxLoss },
	};
}
