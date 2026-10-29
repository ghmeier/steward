import type {
	Condition,
	Decree,
	DecreeRule,
	HARVEST_POLICIES,
	Petition,
} from "../core/decree";
import { JOBS, type Job } from "../core/realm";
import type { Tuning } from "../core/tuning";

export function words(identifier: string): string {
	return identifier.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`);
}

export function formatCondition(condition: Condition): string {
	switch (condition.kind) {
		case "compare":
			return `${words(condition.quantity)} ${condition.comparison} ${String(condition.value)}`;
		case "season":
			return `it is ${condition.season}`;
		case "chose":
			return `${condition.decree} chose ${condition.policy}`;
		case "all":
			return `all of (${condition.conditions.map(formatCondition).join(", ")})`;
		case "any":
			return `any of (${condition.conditions.map(formatCondition).join(", ")})`;
		case "not":
			return `not (${formatCondition(condition.condition)})`;
	}
}

export function formatRule(rule: DecreeRule): string {
	return `${rule.policy} when ${formatCondition(rule.when)}`;
}

export function formatDecree(decree: Decree): string {
	const clauses = decree.rules.map(formatRule);
	clauses.push(`otherwise ${decree.otherwise}`);
	return `${decree.id} (${decree.petition}): ${clauses.join("; ")}`;
}

export function plain(value: number): string {
	return String(Number(value.toPrecision(3)));
}

export function percent(share: number): string {
	return `${plain(share * 100)}%`;
}

const HARVEST_DESCRIPTIONS: Readonly<
	Record<(typeof HARVEST_POLICIES)[number], string>
> = {
	feed: "the surplus grows the village",
	sell: "the surplus is sold for coin",
	stockpile: "the surplus is stored",
};

const EVERYONE: Readonly<Record<Job, string>> = {
	farm: "everyone farms",
	forest: "everyone works the forest",
	mine: "everyone mines",
};

export function describePolicy(
	petition: Petition,
	policy: string,
	tuning: Tuning,
): string {
	if (petition === "harvest") {
		const text = (HARVEST_DESCRIPTIONS as Readonly<Record<string, string>>)[
			policy
		];
		return text === undefined ? policy : `${policy}: ${text}`;
	}
	const shares = tuning.economy.laborAllocations[policy];
	if (shares === undefined) return policy;
	const sole = JOBS.find((job) => shares[job] === 1);
	if (sole !== undefined) return `${policy}: ${EVERYONE[sole]}`;
	const split = JOBS.map((job) => `${job} ${percent(shares[job])}`);
	return `${policy}: ${split.join(", ")}`;
}
