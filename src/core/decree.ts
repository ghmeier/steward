import { compareKeys, isRecord, sortedKeys } from "./data";
import { SEASONS, type Season } from "./realm";

export const PETITIONS = ["harvest", "wood", "ore", "labor"] as const;
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

function collectChoses(
	condition: Condition,
	into: { decree: string; policy: string }[],
): void {
	switch (condition.kind) {
		case "chose":
			into.push({ decree: condition.decree, policy: condition.policy });
			return;
		case "all":
		case "any":
			for (const child of condition.conditions) collectChoses(child, into);
			return;
		case "not":
			collectChoses(condition.condition, into);
			return;
		default:
			return;
	}
}

export function choseConditions(
	decree: Decree,
): { decree: string; policy: string }[] {
	const found: { decree: string; policy: string }[] = [];
	for (const rule of decree.rules) collectChoses(rule.when, found);
	return found;
}

export function decreeReferences(decree: Decree): string[] {
	const found = new Set(choseConditions(decree).map((entry) => entry.decree));
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

export const HARVEST_POLICIES = ["feed", "sell", "stockpile"] as const;
export const STORE_POLICIES = ["sell", "stockpile"] as const;

/** The resource each resource petition governs; `harvest` keeps its id for grain so saves stay valid. */
export const PETITION_RESOURCE = {
	harvest: "grain",
	wood: "wood",
	ore: "ore",
} as const;
export type ResourcePetition = keyof typeof PETITION_RESOURCE;

export function formatCycle(cycle: readonly string[]): string {
	return [...cycle, cycle[0]].join(" -> ");
}

/**
 * The checks on a whole decree set that need no tuning, shared by enacting and by
 * state validation. Labor policies are only checked when the caller can supply them.
 * `incoming` is the decree being enacted, so a petition clash names the decree already in place.
 */
export function decreeSetProblem(
	decrees: Readonly<Record<string, Decree>>,
	laborPolicies: readonly string[] | null,
	incoming?: string,
): string | null {
	const ids = sortedKeys(decrees);
	const policiesOf = (petition: Petition): readonly string[] | null => {
		if (petition === "harvest") return HARVEST_POLICIES;
		if (petition === "labor") return laborPolicies;
		return STORE_POLICIES;
	};

	for (const id of ids) {
		const decree = decrees[id];
		if (!decree) continue;
		const allowed = policiesOf(decree.petition);
		if (!allowed) continue;
		const used = [...decree.rules.map((rule) => rule.policy), decree.otherwise];
		for (const policy of used) {
			if (!allowed.includes(policy)) {
				return `decree "${id}": policy "${policy}" is not a ${decree.petition} policy`;
			}
		}
	}

	const handlers = new Map<Petition, string[]>();
	for (const id of ids) {
		const petition = decrees[id]?.petition;
		if (petition)
			handlers.set(petition, [...(handlers.get(petition) ?? []), id]);
	}
	for (const petition of PETITIONS) {
		const handling = handlers.get(petition) ?? [];
		if (handling.length > 1) {
			const other = handling.find((id) => id !== incoming) ?? handling[0];
			return `decree "${other}" already handles the ${petition} petition`;
		}
	}

	for (const id of ids) {
		const decree = decrees[id];
		if (!decree) continue;
		for (const test of choseConditions(decree)) {
			const target = Object.hasOwn(decrees, test.decree)
				? decrees[test.decree]
				: undefined;
			if (!target) {
				return `decree "${id}" references unknown decree "${test.decree}"`;
			}
			const allowed = policiesOf(target.petition);
			if (allowed && !allowed.includes(test.policy)) {
				return `decree "${id}" tests for policy "${test.policy}", which decree "${test.decree}" cannot choose`;
			}
		}
	}

	const order = orderDecrees(decrees);
	if (!order.ok) return `decree cycle: ${formatCycle(order.cycle)}`;
	return null;
}
