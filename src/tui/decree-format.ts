import { copy } from "../core/copy";
import type { Condition, Decree, DecreeRule, Petition } from "../core/decree";
import { LaborSplit } from "../core/labor-split";
import { WORKING_JOBS } from "../core/realm";
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
      return copy.decrees.allOf({
        conditions: condition.conditions.map(formatCondition).join(", "),
      });
    case "any":
      return copy.decrees.anyOf({
        conditions: condition.conditions.map(formatCondition).join(", "),
      });
    case "not":
      return `not (${formatCondition(condition.condition)})`;
  }
}

/** A labor split reads as its jobs and shares; any other policy is already a plain word. */
export function formatPolicy(policy: string): string {
  const split = LaborSplit.fromPolicy(policy);
  return split?.ok ? split.split.format(" · ") : policy;
}

export function formatRule(rule: DecreeRule): string {
  return `${formatPolicy(rule.policy)} when ${formatCondition(rule.when)}`;
}

export function formatDecree(decree: Decree): string {
  const clauses = decree.rules.map(formatRule);
  clauses.push(`otherwise ${formatPolicy(decree.otherwise)}`);
  return `${decree.id} (${decree.petition}): ${clauses.join("; ")}`;
}

export function plain(value: number): string {
  return String(Number(value.toPrecision(3)));
}

export function percent(share: number): string {
  return `${plain(share * 100)}%`;
}

export function describePolicy(
  petition: Petition,
  policy: string,
  tuning: Tuning,
): string {
  if (petition === "harvest") {
    const text = (
      copy.decrees.harvestPolicies as Readonly<Record<string, string>>
    )[policy];
    return text === undefined ? policy : `${policy}: ${text}`;
  }
  if (petition === "wood" || petition === "ore") {
    const describe = (
      copy.decrees.storePolicies as Readonly<
        Record<string, (args: { resource: string }) => string>
      >
    )[policy];
    return describe === undefined
      ? policy
      : `${policy}: ${describe({ resource: petition })}`;
  }
  const shares = tuning.economy.laborAllocations[policy];
  if (shares === undefined) return policy;
  const sole = WORKING_JOBS.find((job) => shares[job] === 1);
  if (sole !== undefined) return `${policy}: ${copy.decrees.everyone[sole]}`;
  const split = WORKING_JOBS.map((job) => `${job} ${percent(shares[job])}`);
  return `${policy}: ${split.join(", ")}`;
}
