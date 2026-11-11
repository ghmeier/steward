import type { Command } from "../core/commands";
import { copy } from "../core/copy";
import {
  type Condition,
  DECREE_ID_PATTERN,
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
import { CONJURABLE } from "../core/illusion";
import { LaborSplit } from "../core/labor-split";
import {
  Job,
  RESOURCES,
  type Resource,
  SEASONS,
  WORKING_JOBS,
  type WorkingJob,
} from "../core/realm";
import {
  ARCHIVE_PANEL,
  CHAINING_UNLOCK,
  COMPOUND_UNLOCK,
  CONJURING,
  CROWN_CORRESPONDENCE,
  CROWN_PANEL,
  PALETTE_UNLOCK,
  SAVED_DECREES_UNLOCK,
  type UnlockId,
} from "../core/unlocks";
import { describePolicy, formatDecree, words } from "./decree-format";
import type { KeyPress } from "./keys";
import type { MenuContext, MenuRender } from "./menu";

export type Suggestion = { text: string; description: string };
export type LineState = { text: string; highlight: number };
export type LineResult = {
  suggestions: Suggestion[];
  command: Command | null;
  problem: string | null;
};

const MAX_SUGGESTIONS_SHOWN = 6;
const NUMBER = /^-?\d+(\.\d+)?(e[+-]?\d+)?$/;
const NUMBER_PREFIX = /^-?\d*\.?\d*(e[+-]?\d*)?$/;

type Choice<T> = {
  text: string;
  description: string;
  value: T;
  /** Set when this choice alone already ends a command, so an exact match is accepted like a final word. */
  final?: boolean;
};
/** A suggestion plus the whole line that accepting it produces, so tab never has to guess where the partial word began. */
type Option = Suggestion & { completion: string };

/** Thrown when the text so far cannot go further: it is incomplete (suggestions) or wrong (problem). */
class Halt extends Error {
  constructor(
    readonly options: Option[],
    readonly problem: string | null,
    readonly expecting: string | null,
  ) {
    super(problem ?? "incomplete");
  }
}

type ExpectOptions = {
  /** The last word of the command: an exact match at the end of the text is accepted. */
  final?: boolean;
  unmatched?: (word: string) => string | null;
};

function isWorkingJob(word: string): word is WorkingJob {
  return (WORKING_JOBS as readonly string[]).includes(word);
}

class Cursor {
  private position = 0;
  // Set when the word just consumed could also begin a longer choice, so the next slot can offer both.
  private alternatives: Option[] = [];
  /** `text` has commas turned into spaces, so rules may be separated by a comma or nothing. */
  private readonly text: string;

  constructor(private readonly original: string) {
    this.text = original.replaceAll(",", " ");
  }

  private skipSpaces(): string {
    while (this.text[this.position] === " ") this.position += 1;
    return this.text.slice(this.position);
  }

  private optionFor(text: string, description: string): Option {
    const head = this.original.slice(0, this.position);
    return { text, description, completion: `${head}${text} ` };
  }

  expect<T>(
    expected: string,
    choices: readonly Choice<T>[],
    options: ExpectOptions = {},
  ): Choice<T> {
    const rest = this.skipSpaces();
    const offer = (list: readonly Choice<T>[]) =>
      list.map((choice) => this.optionFor(choice.text, choice.description));
    if (rest === "") {
      const extra = this.alternatives;
      this.alternatives = [];
      throw new Halt([...offer(choices), ...extra], null, null);
    }
    const matches = choices.filter(
      (choice) => rest === choice.text || rest.startsWith(`${choice.text} `),
    );
    const best = matches.reduce<Choice<T> | undefined>(
      (longest, choice) =>
        longest === undefined || choice.text.length > longest.text.length
          ? choice
          : longest,
      undefined,
    );
    const prefixed = choices.filter((choice) => choice.text.startsWith(rest));
    if (best === undefined) {
      if (prefixed.length > 0) throw new Halt(offer(prefixed), null, null);
      const word = rest.split(" ")[0] ?? rest;
      const problem =
        options.unmatched?.(word) ??
        copy.commandLine.notExpected({ word, expected });
      throw new Halt([], problem, null);
    }
    if (rest === best.text && !options.final && !best.final) {
      throw new Halt(offer(prefixed), null, null);
    }
    const trailing = rest.slice(best.text.length);
    if (trailing.trim() === "") {
      const longer = prefixed.filter((choice) => choice.text !== best.text);
      this.alternatives = offer(longer);
    }
    this.position += best.text.length;
    return best;
  }

  /** The last word of a command may be a finished number as it stands, since enter will not wait for more digits. */
  number(final = false): number {
    const rest = this.skipSpaces();
    if (rest === "") throw new Halt([], null, copy.commandLine.numberHelp);
    const word = rest.split(" ")[0] ?? rest;
    const typing = word.length === rest.length;
    if (typing && !(final && NUMBER.test(word)) && NUMBER_PREFIX.test(word)) {
      throw new Halt([], null, copy.commandLine.numberHelp);
    }
    const value = Number(word);
    if (!NUMBER.test(word) || !Number.isFinite(value)) {
      throw new Halt(
        [],
        copy.commandLine.notExpected({
          word,
          expected: copy.commandLine.expected.number,
        }),
        null,
      );
    }
    this.position += word.length;
    return value === 0 ? 0 : value;
  }

  /**
   * A labor split such as `farm 60 forest 30`, or null when the text is not one. A job followed by a
   * number starts a split, so a preset word alone, like `farm`, stays a preset. The last word of a
   * command may be a finished number as it stands, as with `number`.
   */
  laborSplit(final: boolean): string | null {
    const [first = "", second = ""] = this.skipSpaces().split(/ +/);
    if (!isWorkingJob(first) || !/^[-\d.]/.test(second)) return null;

    const entries: [string, number][] = [];
    for (;;) {
      const job = this.skipSpaces().split(" ")[0] ?? "";
      this.position += job.length;
      entries.push([job, this.number(final)]);

      const rest = this.skipSpaces();
      const word = rest.split(" ")[0] ?? "";
      const unused = WORKING_JOBS.filter(
        (name) => !entries.some(([taken]) => taken === name),
      );
      const choices = unused.map((name) =>
        this.optionFor(name, copy.commandLine.jobHelp[name]),
      );
      if (rest === "") {
        this.alternatives = choices;
        break;
      }
      const typing = word.length === rest.length;
      const partial = choices.filter(
        (choice) => choice.text.startsWith(word) && choice.text !== word,
      );
      if (typing && partial.length > 0) throw new Halt(partial, null, null);
      if (!isWorkingJob(word)) break;
    }

    const split = LaborSplit.fromEntries(entries);
    if (!split.ok) return this.fail(split.problem);
    return split.split.format();
  }

  /** A free-text name; the text typed so far is accepted while it could still become a valid name. */
  name(help: string): string {
    const rest = this.skipSpaces();
    if (rest === "") throw new Halt([], null, help);
    const word = rest.split(" ")[0] ?? rest;
    const typing = word.length === rest.length;
    if (typing && DECREE_ID_PATTERN.test(word)) throw new Halt([], null, help);
    if (!DECREE_ID_PATTERN.test(word)) {
      throw new Halt([], copy.commandLine.invalidName({ word }), null);
    }
    this.position += word.length;
    return word;
  }

  fail(problem: string): never {
    throw new Halt([], problem, null);
  }

  finish(): void {
    const rest = this.skipSpaces();
    if (rest !== "") {
      this.fail(copy.commandLine.doesNotBelong({ rest }));
    }
  }
}

type Verb = {
  word: string;
  description: string;
  /** Whether the player may use the verb now; the palette and the first word offer only these. */
  available: (context: MenuContext) => boolean;
  /** Set for a verb that takes no arguments, so typing its word is already a whole command. */
  bare?: true;
  /** What to tell a player who types an unavailable verb, naming where it comes from. */
  unavailableProblem: (context: MenuContext) => string;
  parse: (cursor: Cursor, context: MenuContext) => Command;
};

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
  const verbs: Choice<"compare" | "chose">[] = [];
  if (subject.quantity !== null) {
    verbs.push(
      ...COMPARISONS.map((choice) => ({
        ...choice,
        value: "compare" as const,
      })),
    );
  }
  if (subject.id !== null) {
    verbs.push({
      text: "chose",
      description: copy.commandLine.keywordHelp.chose,
      value: "chose",
    });
  }
  const next = cursor.expect(
    copy.commandLine.expected.comparisonOrChose,
    verbs,
  );
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

function parseDecreeVerb(
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

function parseRepealVerb(cursor: Cursor, context: MenuContext): Command {
  const decrees = context.view.decrees;
  if (decrees.length === 0) cursor.fail(copy.commandLine.noDecreesInForce);
  const id = cursor.expect(
    copy.commandLine.expected.decreeInForce,
    decrees.map((decree) => ({
      text: decree.id,
      description: formatDecree(decree),
      value: decree.id,
    })),
    { final: true },
  ).value;
  return { type: "repealDecree", id };
}

function ownsUnlock(context: MenuContext, id: UnlockId): boolean {
  return context.view.unlocks.includes(id);
}

function entryLabel(context: MenuContext, id: UnlockId): string {
  return (
    context.tuning.archive.entries.find((entry) => entry.id === id)?.label ?? id
  );
}

function needsUnlock(id: UnlockId, verb: string) {
  return {
    available: (context: MenuContext) => ownsUnlock(context, id),
    unavailableProblem: (context: MenuContext) =>
      id === ARCHIVE_PANEL
        ? copy.commandLine.needsArchive({ verb })
        : copy.commandLine.needsEntry({
            verb,
            label: entryLabel(context, id),
          }),
  };
}

const always = {
  available: () => true,
  unavailableProblem: () => "",
};

function slugOf(id: UnlockId): string {
  return id
    .slice(id.indexOf(".") + 1)
    .replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function coinHeld(context: MenuContext): number {
  return (
    context.view.ledger.find((line) => line.resource === "coin")?.amount ?? 0
  );
}

function parseBuyVerb(cursor: Cursor, context: MenuContext): Command {
  const { entries } = context.view.archive;
  const coin = coinHeld(context);
  const offered = entries.filter((entry) => !entry.owned && entry.available);
  if (entries.every((entry) => entry.owned)) {
    cursor.fail(copy.commandLine.ownEverything);
  }
  if (offered.length === 0) cursor.fail(copy.commandLine.nothingToBuyYet);
  const id = cursor.expect(
    copy.commandLine.expected.archiveEntryToBuy,
    offered.map((entry) => {
      const help = {
        label: entry.label,
        cost: String(entry.cost),
        description: entry.description,
      };
      return {
        text: slugOf(entry.id),
        description: entry.affordable
          ? copy.commandLine.archiveEntryHelp(help)
          : copy.commandLine.archiveEntryShortHelp({
              ...help,
              shortfall: String(Math.ceil(entry.cost - coin)),
            }),
        value: entry.id,
      };
    }),
    {
      final: true,
      unmatched: (word) => {
        const known = entries.find((entry) => slugOf(entry.id) === word);
        if (known === undefined) return null;
        if (known.owned)
          return copy.commandLine.alreadyOwn({ label: known.label });
        const missing = context.tuning.archive.entries
          .find((entry) => entry.id === known.id)
          ?.requires.filter((id) => !ownsUnlock(context, id))
          .map((id) => entryLabel(context, id));
        return copy.commandLine.needsFirst({
          label: known.label,
          missing: (missing ?? []).join(" and "),
        });
      },
    },
  ).value;
  return { type: "buyUnlock", id };
}

function parseSaveVerb(cursor: Cursor, context: MenuContext): Command {
  const name = cursor.name(copy.commandLine.nameHelp);
  cursor.expect(copy.commandLine.expected.decree, [
    {
      text: "decree",
      description: copy.commandLine.keywordHelp.decree,
      value: null,
    },
  ]);
  return parseDecreeVerb(cursor, context, (decree) => ({
    type: "saveDecree",
    name,
    decree,
  }));
}

function savedChoices(context: MenuContext): Choice<string>[] {
  return context.view.savedDecrees.map((decree) => ({
    text: decree.id,
    description: formatDecree(decree),
    value: decree.id,
  }));
}

function parseSavedVerb(type: "enactSaved" | "forgetSaved") {
  return (cursor: Cursor, context: MenuContext): Command => {
    if (context.view.savedDecrees.length === 0) {
      cursor.fail(copy.commandLine.noDecreesSaved);
    }
    const name = cursor.expect(
      copy.commandLine.expected.savedDecree,
      savedChoices(context),
      { final: true },
    ).value;
    return { type, name };
  };
}

const JOBS: readonly Choice<Job>[] = [
  { text: "farm", description: copy.commandLine.jobHelp.farm, value: Job.FARM },
  {
    text: "forest",
    description: copy.commandLine.jobHelp.forest,
    value: Job.FOREST,
  },
  { text: "mine", description: copy.commandLine.jobHelp.mine, value: Job.MINE },
  { text: "idle", description: copy.commandLine.jobHelp.idle, value: Job.IDLE },
];

function parseAssignVerb(cursor: Cursor, context: MenuContext): Command {
  const peasant = cursor.expect(
    copy.commandLine.expected.peasant,
    context.view.delegates.map((delegate) => ({
      text: delegate.name,
      description: delegate.job,
      value: delegate.id,
    })),
  ).value;
  const job = cursor.expect(copy.commandLine.expected.job, JOBS, {
    final: true,
  }).value;
  return { type: "assignPeasant", peasant, job };
}

function resourceChoices(resources: readonly Resource[]): Choice<Resource>[] {
  return resources.map((resource) => ({
    text: resource,
    description: copy.commandLine.resourceHelp[resource],
    value: resource,
  }));
}

const conjuringVerb = (verb: string) => ({
  available: (context: MenuContext) => ownsUnlock(context, CONJURING),
  unavailableProblem: () => copy.commandLine.needsConjuring({ verb }),
});

function parseConjureVerb(cursor: Cursor): Command {
  const resource = cursor.expect(
    copy.commandLine.expected.resourceToConjure,
    resourceChoices(CONJURABLE),
  ).value;
  return { type: "conjure", resource, amount: cursor.number(true) };
}

function parseBackVerb(cursor: Cursor): Command {
  const resource = cursor.expect(
    copy.commandLine.expected.resource,
    resourceChoices(RESOURCES),
    { final: true },
  ).value;
  return { type: "back", resource };
}

/** New verbs are appended here; each parses the rest of the line with the same cursor. */
const VERBS: readonly Verb[] = [
  {
    word: "decree",
    description: copy.commandLine.verbHelp.decree,
    ...always,
    parse: (cursor, context) =>
      parseDecreeVerb(cursor, context, (decree) => ({
        type: "enactDecree",
        decree,
      })),
  },
  {
    word: "repeal",
    description: copy.commandLine.verbHelp.repeal,
    ...always,
    parse: parseRepealVerb,
  },
  {
    word: "buy",
    description: copy.commandLine.verbHelp.buy,
    ...needsUnlock(ARCHIVE_PANEL, "buy"),
    parse: parseBuyVerb,
  },
  {
    word: "save",
    description: copy.commandLine.verbHelp.save,
    ...needsUnlock(SAVED_DECREES_UNLOCK, "save"),
    parse: parseSaveVerb,
  },
  {
    word: "enact",
    description: copy.commandLine.verbHelp.enact,
    ...needsUnlock(SAVED_DECREES_UNLOCK, "enact"),
    parse: parseSavedVerb("enactSaved"),
  },
  {
    word: "forget",
    description: copy.commandLine.verbHelp.forget,
    available: (context) => context.view.savedDecrees.length > 0,
    unavailableProblem: () => copy.commandLine.noSavedDecreesToForget,
    parse: parseSavedVerb("forgetSaved"),
  },
  {
    word: "assign",
    description: copy.commandLine.verbHelp.assign,
    ...needsUnlock(PALETTE_UNLOCK, "assign"),
    parse: parseAssignVerb,
  },
  {
    word: "deliver",
    bare: true,
    description: copy.commandLine.verbHelp.deliver,
    available: (context) => ownsUnlock(context, CROWN_PANEL),
    unavailableProblem: () => copy.commandLine.needsCrown,
    parse: () => ({ type: "deliver" }),
  },
  {
    word: "conjure",
    description: copy.commandLine.verbHelp.conjure,
    ...conjuringVerb("conjure"),
    parse: parseConjureVerb,
  },
  {
    word: "forge",
    bare: true,
    description: copy.commandLine.verbHelp.forge,
    ...conjuringVerb("forge"),
    parse: () => ({ type: "forge" }),
  },
  {
    word: "back",
    description: copy.commandLine.verbHelp.back,
    ...conjuringVerb("back"),
    parse: parseBackVerb,
  },
];

type Analysis = LineResult & { options: Option[]; expecting: string | null };

function analyze(text: string, context: MenuContext): Analysis {
  const cursor = new Cursor(text);
  try {
    const verb = cursor.expect(
      copy.commandLine.expected.command,
      VERBS.filter((value) => value.available(context)).map((value) => ({
        text: value.word,
        description: value.description,
        value,
        final: value.bare === true,
      })),
      {
        unmatched: (word) => {
          const locked = VERBS.find((value) => value.word === word);
          return locked === undefined
            ? null
            : locked.unavailableProblem(context);
        },
      },
    ).value;
    const command = verb.parse(cursor, context);
    cursor.finish();
    return {
      suggestions: [],
      options: [],
      command,
      problem: null,
      expecting: null,
    };
  } catch (error) {
    if (!(error instanceof Halt)) throw error;
    return {
      suggestions: error.options.map(({ text: word, description }) => ({
        text: word,
        description,
      })),
      options: error.options,
      command: null,
      problem: error.problem,
      expecting: error.expecting,
    };
  }
}

export function openLine(text: string): LineState {
  return { text, highlight: 0 };
}

export function parseLine(text: string, context: MenuContext): LineResult {
  const { suggestions, command, problem } = analyze(text, context);
  return { suggestions, command, problem };
}

function typedCharacter(key: KeyPress): string | null {
  if (key.name === "space") return " ";
  if (/^[\x20-\x7e]$/.test(key.sequence)) return key.sequence;
  // Kitty-protocol terminals send an escape sequence instead of the character.
  if (key.name === "/" && key.shift) return "?";
  if (/^[\x20-\x7e]$/.test(key.name)) {
    return key.shift ? key.name.toUpperCase() : key.name;
  }
  return null;
}

export function lineKey(
  state: LineState,
  key: KeyPress,
  context: MenuContext,
): { state: LineState | null; commands: Command[] } {
  const stay = { state, commands: [] };
  if (key.ctrl || key.meta) return stay;
  if (key.name === "escape") return { state: null, commands: [] };

  const analysis = analyze(state.text, context);
  const last = Math.max(0, analysis.options.length - 1);
  const highlight = Math.min(state.highlight, last);
  const complete = () => {
    const option = analysis.options[highlight];
    return option === undefined
      ? stay
      : { state: openLine(option.completion), commands: [] };
  };

  switch (key.name) {
    case "up":
      return {
        state: { ...state, highlight: Math.max(0, highlight - 1) },
        commands: [],
      };
    case "down":
      return {
        state: { ...state, highlight: Math.min(last, highlight + 1) },
        commands: [],
      };
    case "tab":
      return complete();
    case "return":
    case "enter":
      if (analysis.command !== null) {
        return { state: null, commands: [analysis.command] };
      }
      return complete();
    case "backspace":
      return { state: openLine(state.text.slice(0, -1)), commands: [] };
  }
  const character = typedCharacter(key);
  if (character === null) return stay;
  return { state: openLine(state.text + character), commands: [] };
}

/** `maxSuggestions` lets a short terminal show fewer than the usual six. */
export function renderLine(
  state: LineState,
  context: MenuContext,
  maxSuggestions = MAX_SUGGESTIONS_SHOWN,
): MenuRender {
  const analysis = analyze(state.text, context);
  const { suggestions } = analysis;
  const highlight = Math.min(
    state.highlight,
    Math.max(0, suggestions.length - 1),
  );
  const limit = Math.min(MAX_SUGGESTIONS_SHOWN, maxSuggestions);
  const first = Math.max(0, highlight - (limit - 1));
  const shown = suggestions.slice(first, first + limit);
  const width = Math.max(
    0,
    ...shown.map((suggestion) => suggestion.text.length),
  );
  const lines = [`: ${state.text}_`];
  for (const [index, suggestion] of shown.entries()) {
    const marker = first + index === highlight ? ">" : " ";
    const description =
      suggestion.description === "" ? "" : `  ${suggestion.description}`;
    lines.push(
      `${marker} ${suggestion.text.padEnd(width)}${description}`.trimEnd(),
    );
  }
  if (analysis.problem !== null) lines.push(`! ${analysis.problem}`);
  else if (suggestions.length === 0 && analysis.expecting !== null) {
    lines.push(`  ${analysis.expecting}`);
  }
  return {
    title: copy.commandLine.title,
    lines,
    hints: copy.commandLine.hints,
  };
}
