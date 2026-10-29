import type { Condition, Decree, DecreeRule } from "../core/decree";

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
