import type { Command } from "../core/commands";
import { copy } from "../core/copy";
import {
  type Condition,
  type Decree,
  type DecreeRule,
  OWED_RESOURCES,
  PETITIONS,
  type Petition,
  parseCondition,
  parseDecree,
  policiesFor,
  QUANTITIES,
  type Quantity,
} from "../core/decree";
import { CAPPED_RESOURCES, SEASONS } from "../core/realm";
import {
  CHAINING_UNLOCK,
  COMPOUND_UNLOCK,
  CROWN_CORRESPONDENCE,
} from "../core/unlocks";
import type { Choice, Cursor, ExpectOptions } from "./command-cursor";
import { describePolicy, words } from "./decree-format";
import { entryLabel, type MenuContext } from "./menu";

type Scope = {
  context: MenuContext;
  compound: boolean;
  chaining: boolean;
  correspondence: boolean;
  ownId: string;
};

const COMPARISONS: readonly Choice<"above" | "below">[] = [
  {
    text: "above",
    description: copy.commandLine.keywordHelp.above,
    value: "above",
  },
  {
    text: "below",
    description: copy.commandLine.keywordHelp.below,
    value: "below",
  },
];

type Subject =
  | { kind: "not" }
  | { kind: "season" }
  | { kind: "named"; quantity: Quantity | null; id: string | null };

function subjects(scope: Scope): Choice<Subject>[] {
  const byText = new Map<string, Choice<Subject>>();
  for (const quantity of QUANTITIES) {
    if (!scope.correspondence && Object.hasOwn(OWED_RESOURCES, quantity)) {
      continue;
    }
    byText.set(words(quantity), {
      text: words(quantity),
      description: copy.commandLine.quantityHelp[quantity],
      value: { kind: "named", quantity, id: null },
    });
  }
  byText.set("it is", {
    text: "it is",
    description: copy.commandLine.keywordHelp.itIs,
    value: { kind: "season" },
  });
  if (scope.compound) {
    byText.set("not", {
      text: "not",
      description: copy.commandLine.keywordHelp.not,
      value: { kind: "not" },
    });
  }
  if (scope.chaining) {
    for (const decree of scope.context.view.decrees) {
      if (decree.id === scope.ownId) continue;
      const existing = byText.get(decree.id);
      const description = copy.commandLine.namedDecreeHelp({
        petition: decree.petition,
      });
      if (existing === undefined) {
        byText.set(decree.id, {
          text: decree.id,
          description,
          value: { kind: "named", quantity: null, id: decree.id },
        });
      } else if (
        existing.value.kind === "named" &&
        existing.value.id === null
      ) {
        existing.value = { ...existing.value, id: decree.id };
      }
    }
  }
  return [...byText.values()];
}

function policyChoices(
  petition: Petition,
  tuning: MenuContext["tuning"],
): Choice<string>[] {
  return policiesFor(petition, tuning).map((policy) => ({
    text: policy,
    description: describePolicy(petition, policy, tuning),
    value: policy,
  }));
}

function parseBase(
  cursor: Cursor,
  scope: Scope,
  subject: Extract<Subject, { kind: "season" | "named" }>,
): Condition {
  if (subject.kind === "season") {
    const season = cursor.expect(
      copy.commandLine.expected.season,
      SEASONS.map((value) => ({ text: value, description: "", value })),
    ).value;
    return { kind: "season", season };
  }
  const verbs: Choice<"compare" | "chose" | "full">[] = [];
  if (subject.quantity !== null) {
    verbs.push(
      ...COMPARISONS.map((choice) => ({
        ...choice,
        value: "compare" as const,
      })),
    );
  }
  const capped = CAPPED_RESOURCES.find((value) => value === subject.quantity);
  if (capped !== undefined) {
    verbs.push({
      text: "is full",
      description: copy.commandLine.keywordHelp.isFull,
      value: "full",
    });
  }
  if (subject.id !== null) {
    verbs.push({
      text: "chose",
      description: copy.commandLine.keywordHelp.chose,
      value: "chose",
    });
  }
  const next = cursor.expect(
    capped === undefined
      ? copy.commandLine.expected.comparisonOrChose
      : copy.commandLine.expected.comparisonOrFullOrChose,
    verbs,
    {
      unmatched: (word) =>
        word === "is" && subject.quantity !== null && capped === undefined
          ? copy.commandLine.notStored({ quantity: words(subject.quantity) })
          : null,
    },
  );
  if (next.value === "full" && capped !== undefined) {
    return { kind: "full", resource: capped };
  }
  if (next.value === "compare" && subject.quantity !== null) {
    return {
      kind: "compare",
      quantity: subject.quantity,
      comparison: next.text === "above" ? "above" : "below",
      value: cursor.number(),
    };
  }
  const id = subject.id ?? "";
  const target = scope.context.view.decrees.find((d) => d.id === id);
  const policies =
    target === undefined
      ? []
      : policyChoices(target.petition, scope.context.tuning);
  const policy = cursor.expect(
    copy.commandLine.expected.policyThatDecreeCanChoose,
    policies,
  );
  return { kind: "chose", decree: id, policy: policy.value };
}

function expectSubject(cursor: Cursor, scope: Scope): Subject {
  return cursor.expect(copy.commandLine.expected.condition, subjects(scope), {
    unmatched: (word) =>
      word === "owed" && !scope.correspondence
        ? copy.commandLine.owedNeedsEntry({
            label: entryLabel(scope.context, CROWN_CORRESPONDENCE),
          })
        : null,
  }).value;
}

function parseAtom(cursor: Cursor, scope: Scope): Condition {
  const first = expectSubject(cursor, scope);
  if (first.kind !== "not") return parseBase(cursor, scope, first);
  const inner = expectSubject(cursor, scope);
  if (inner.kind === "not") return cursor.fail(copy.commandLine.notRepeated);
  return { kind: "not", condition: parseBase(cursor, scope, inner) };
}

type RuleNext =
  | { kind: "policy"; policy: string }
  | { kind: "otherwise" }
  | { kind: "join"; join: "and" | "or" };

function startChoices(
  petition: Petition,
  rulesSoFar: number,
  context: MenuContext,
): Choice<RuleNext>[] {
  const otherwise: Choice<RuleNext> = {
    text: "otherwise",
    description: copy.commandLine.keywordHelp.otherwise,
    value: { kind: "otherwise" },
  };
  if (rulesSoFar >= context.tuning.decrees.maxRules) return [otherwise];
  return [
    ...policyChoices(petition, context.tuning).map((choice) => ({
      ...choice,
      value: { kind: "policy" as const, policy: choice.value },
    })),
    otherwise,
  ];
}

export function parseDecreeVerb(
  cursor: Cursor,
  context: MenuContext,
  build: (decree: Decree) => Command,
): Command {
  const { view, tuning } = context;
  const petition = cursor.expect(
    copy.commandLine.expected.petition,
    PETITIONS.map((value) => ({
      text: value,
      description: copy.commandLine.petitionHelp[value],
      value,
    })),
  ).value;
  const active = view.decrees.find((decree) => decree.petition === petition);
  const scope: Scope = {
    context,
    compound: view.unlocks.includes(COMPOUND_UNLOCK),
    chaining: view.unlocks.includes(CHAINING_UNLOCK),
    correspondence: view.unlocks.includes(CROWN_CORRESPONDENCE),
    ownId: active?.id ?? petition,
  };
  const { maxRules } = tuning.decrees;
  const tooMany = (rulesSoFar: number) => (word: string) =>
    rulesSoFar >= maxRules && policiesFor(petition, tuning).includes(word)
      ? copy.commandLine.tooManyRules({ maxRules: String(maxRules) })
      : null;
  const when: Choice<null> = {
    text: "when",
    description: copy.commandLine.keywordHelp.when,
    value: null,
  };

  const rules: DecreeRule[] = [];
  const expectRuleStart = (
    expected: string,
    choices: Choice<RuleNext>[],
    options: ExpectOptions,
  ): RuleNext => {
    const split = petition === "labor" ? cursor.laborSplit(false) : null;
    return split === null
      ? cursor.expect(expected, choices, options).value
      : { kind: "policy", policy: split };
  };
  let head = expectRuleStart(
    copy.commandLine.expected.policyOrOtherwise,
    startChoices(petition, 0, context),
    { unmatched: tooMany(0) },
  );
  while (head.kind === "policy") {
    const { policy } = head;
    cursor.expect(copy.commandLine.expected.when, [when]);
    const atoms: Condition[] = [];
    let join: "and" | "or" | null = null;
    let next: RuleNext;
    for (;;) {
      atoms.push(parseAtom(cursor, scope));
      const joins: Choice<RuleNext>[] = [];
      const roomForAnother =
        nodeCount(combine(atoms, "and")) + 1 <=
        tuning.decrees.maxConditionNodes;
      for (const word of ["and", "or"] as const) {
        if (
          scope.compound &&
          roomForAnother &&
          (join === null || join === word)
        ) {
          joins.push({
            text: word,
            description:
              word === "and"
                ? copy.commandLine.keywordHelp.and
                : copy.commandLine.keywordHelp.or,
            value: { kind: "join", join: word },
          });
        }
      }
      const taken: "and" | "or" | null = join;
      next = expectRuleStart(
        copy.commandLine.expected.joinPolicyOrOtherwise,
        [...joins, ...startChoices(petition, rules.length + 1, context)],
        {
          unmatched: (word) => {
            if (scope.compound && (word === "and" || word === "or")) {
              if (!roomForAnother) return conditionLimitProblem(tuning);
              if (taken !== null) {
                return copy.commandLine.mixedJoins;
              }
            }
            return tooMany(rules.length + 1)(word);
          },
        },
      );
      if (next.kind !== "join") break;
      join = next.join;
    }
    const condition = combine(atoms, join);
    if (nodeCount(condition) > tuning.decrees.maxConditionNodes) {
      cursor.fail(conditionLimitProblem(tuning));
    }
    try {
      parseCondition(condition, tuning.decrees, "condition");
    } catch (error) {
      cursor.fail(plainReason(error));
    }
    rules.push({ when: condition, policy });
    head = next;
  }

  const otherwise =
    (petition === "labor" ? cursor.laborSplit(true) : null) ??
    cursor.expect(
      copy.commandLine.expected.policy,
      policyChoices(petition, tuning),
      { final: true },
    ).value;
  const decree: Decree = { id: scope.ownId, petition, rules, otherwise };
  try {
    parseDecree(decree, tuning.decrees);
  } catch (error) {
    cursor.fail(plainReason(error));
  }
  return build(decree);
}

function conditionLimitProblem(tuning: MenuContext["tuning"]): string {
  return copy.commandLine.tooManyConditionParts({
    maxParts: String(tuning.decrees.maxConditionNodes),
  });
}

function nodeCount(condition: Condition): number {
  switch (condition.kind) {
    case "all":
    case "any":
      return (
        1 +
        condition.conditions.reduce((sum, child) => sum + nodeCount(child), 0)
      );
    case "not":
      return 1 + nodeCount(condition.condition);
    default:
      return 1;
  }
}

/** The core words its errors with a field path ("decree.rules[0].when: ..."), which means nothing to a player. */
function plainReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^[\w.[\]]+: /, "");
}

function combine(atoms: Condition[], join: "and" | "or" | null): Condition {
  const [only] = atoms;
  if (atoms.length === 1 && only !== undefined) return only;
  return { kind: join === "or" ? "any" : "all", conditions: atoms };
}
