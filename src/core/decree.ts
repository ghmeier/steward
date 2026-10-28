import { compareKeys, isRecord, sortedKeys } from "./data";
import { SEASONS, type Season } from "./realm";

export const PETITIONS = ["harvest", "labor"] as const;
export type Petition = (typeof PETITIONS)[number];
export const QUANTITIES = [
	"coin",
	"grain",
	"grainSeasons",
	"idle",
	"ore",
	"population",
	"wood",
] as const;
export type Quantity = (typeof QUANTITIES)[number];
export type Condition =
	| {
			kind: "compare";
			quantity: Quantity;
			comparison: "above" | "below";
			value: number;
	  }
	| { kind: "season"; season: Season }
	| { kind: "chose"; decree: string; policy: string }
	| { kind: "all"; conditions: Condition[] }
	| { kind: "any"; conditions: Condition[] }
	| { kind: "not"; condition: Condition };
export type DecreeRule = { when: Condition; policy: string };
export type Decree = {
	id: string;
	petition: Petition;
	rules: DecreeRule[];
	otherwise: string;
};
export type DecreeLimits = {
	maxRules: number;
	maxConditionNodes: number;
	maxConditionDepth: number;
};

export const DECREE_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

function expectObject(
	value: unknown,
	path: string,
	keys: readonly string[],
): Record<string, unknown> {
	if (!isRecord(value)) throw new Error(`${path}: must be an object`);
	const expected = [...keys].sort(compareKeys);
	for (const key of expected) {
		if (!Object.hasOwn(value, key))
			throw new Error(`${path}.${key}: is missing`);
	}
	for (const key of sortedKeys(value)) {
		if (!expected.includes(key)) throw new Error(`${path}.${key}: unknown key`);
	}
	return value;
}

function expectOneOf<T extends string>(
	value: unknown,
	path: string,
	label: string,
	allowed: readonly T[],
): T {
	const found = allowed.find((candidate) => candidate === value);
	if (found === undefined)
		throw new Error(`${path}: unknown ${label} ${JSON.stringify(value)}`);
	return found;
}

function expectId(value: unknown, path: string): string {
	if (typeof value !== "string" || !DECREE_ID_PATTERN.test(value)) {
		throw new Error(`${path}: must match ${DECREE_ID_PATTERN}`);
	}
	return value;
}

function expectPolicy(value: unknown, path: string): string {
	if (typeof value !== "string" || value === "") {
		throw new Error(`${path}: must be a non-empty string`);
	}
	return value;
}

function expectFinite(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`${path}: must be a finite number`);
	}
	// Normalizes -0, which state must never hold.
	return value === 0 ? 0 : value;
}

type Budget = { nodes: number };

function parseNode(
	value: unknown,
	limits: DecreeLimits,
	path: string,
	depth: number,
	budget: Budget,
): Condition {
	if (!isRecord(value)) throw new Error(`${path}: must be an object`);
	if (depth > limits.maxConditionDepth) {
		throw new Error(
			`${path}: nests deeper than ${limits.maxConditionDepth} levels`,
		);
	}
	budget.nodes += 1;
	if (budget.nodes > limits.maxConditionNodes) {
		throw new Error(
			`${path}: condition has more than ${limits.maxConditionNodes} nodes`,
		);
	}
	if (!Object.hasOwn(value, "kind"))
		throw new Error(`${path}.kind: is missing`);
	const kind = expectOneOf(value.kind, `${path}.kind`, "condition kind", [
		"compare",
		"season",
		"chose",
		"all",
		"any",
		"not",
	] as const);
	switch (kind) {
		case "compare": {
			const object = expectObject(value, path, [
				"kind",
				"quantity",
				"comparison",
				"value",
			]);
			return {
				kind,
				quantity: expectOneOf(
					object.quantity,
					`${path}.quantity`,
					"quantity",
					QUANTITIES,
				),
				comparison: expectOneOf(
					object.comparison,
					`${path}.comparison`,
					"comparison",
					["above", "below"] as const,
				),
				value: expectFinite(object.value, `${path}.value`),
			};
		}
		case "season": {
			const object = expectObject(value, path, ["kind", "season"]);
			return {
				kind,
				season: expectOneOf(object.season, `${path}.season`, "season", SEASONS),
			};
		}
		case "chose": {
			const object = expectObject(value, path, ["kind", "decree", "policy"]);
			return {
				kind,
				decree: expectId(object.decree, `${path}.decree`),
				policy: expectPolicy(object.policy, `${path}.policy`),
			};
		}
		case "all":
		case "any": {
			const object = expectObject(value, path, ["kind", "conditions"]);
			const list = object.conditions;
			if (!Array.isArray(list))
				throw new Error(`${path}.conditions: must be an array`);
			if (list.length === 0)
				throw new Error(`${path}.conditions: needs at least one condition`);
			const conditions: Condition[] = [];
			for (let index = 0; index < list.length; index++) {
				conditions.push(
					parseNode(
						list[index],
						limits,
						`${path}.conditions[${index}]`,
						depth + 1,
						budget,
					),
				);
			}
			return { kind, conditions };
		}
		case "not": {
			const object = expectObject(value, path, ["kind", "condition"]);
			return {
				kind,
				condition: parseNode(
					object.condition,
					limits,
					`${path}.condition`,
					depth + 1,
					budget,
				),
			};
		}
	}
}

export function parseCondition(
	value: unknown,
	limits: DecreeLimits,
	path: string,
): Condition {
	return parseNode(value, limits, path, 1, { nodes: 0 });
}

export function parseDecree(value: unknown, limits: DecreeLimits): Decree {
	const object = expectObject(value, "decree", [
		"id",
		"petition",
		"rules",
		"otherwise",
	]);
	const list = object.rules;
	if (!Array.isArray(list)) throw new Error("decree.rules: must be an array");
	if (list.length > limits.maxRules) {
		throw new Error(`decree.rules: has more than ${limits.maxRules} rules`);
	}
	const rules: DecreeRule[] = [];
	for (let index = 0; index < list.length; index++) {
		const path = `decree.rules[${index}]`;
		const rule = expectObject(list[index], path, ["when", "policy"]);
		rules.push({
			when: parseCondition(rule.when, limits, `${path}.when`),
			policy: expectPolicy(rule.policy, `${path}.policy`),
		});
	}
	return {
		id: expectId(object.id, "decree.id"),
		petition: expectOneOf(
			object.petition,
			"decree.petition",
			"petition",
			PETITIONS,
		),
		rules,
		otherwise: expectPolicy(object.otherwise, "decree.otherwise"),
	};
}

function collectReferences(condition: Condition, into: Set<string>): void {
	switch (condition.kind) {
		case "chose":
			into.add(condition.decree);
			return;
		case "all":
		case "any":
			for (const child of condition.conditions) collectReferences(child, into);
			return;
		case "not":
			collectReferences(condition.condition, into);
			return;
		default:
			return;
	}
}

export function decreeReferences(decree: Decree): string[] {
	const found = new Set<string>();
	for (const rule of decree.rules) collectReferences(rule.when, found);
	return [...found].sort(compareKeys);
}

export type DecreeOrder =
	| { ok: true; order: string[] }
	| { ok: false; cycle: string[] };

export function orderDecrees(
	decrees: Readonly<Record<string, Decree>>,
): DecreeOrder {
	const ids = sortedKeys(decrees);
	const dependencies = new Map<string, string[]>();
	for (const id of ids) {
		const decree = decrees[id];
		const known = decree
			? decreeReferences(decree).filter((ref) => Object.hasOwn(decrees, ref))
			: [];
		dependencies.set(id, known);
	}

	const placed = new Set<string>();
	const order: string[] = [];
	for (;;) {
		const next = ids.find(
			(id) =>
				!placed.has(id) &&
				(dependencies.get(id) ?? []).every((ref) => placed.has(ref)),
		);
		if (next === undefined) break;
		placed.add(next);
		order.push(next);
	}
	if (order.length === ids.length) return { ok: true, order };

	// Every unplaced decree waits on another unplaced one, so following those edges must revisit an id.
	const walk: string[] = [];
	let current = ids.find((id) => !placed.has(id));
	while (current !== undefined && !walk.includes(current)) {
		walk.push(current);
		current = (dependencies.get(current) ?? []).find((ref) => !placed.has(ref));
	}
	return {
		ok: false,
		cycle: current === undefined ? walk : walk.slice(walk.indexOf(current)),
	};
}
