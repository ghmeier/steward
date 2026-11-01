import type { Command } from "../core/commands";
import {
	type Condition,
	type Decree,
	type DecreeRule,
	PETITIONS,
	type Petition,
	parseCondition,
	parseDecree,
	QUANTITIES,
	type Quantity,
} from "../core/decree";
import { policiesFor } from "../core/decree-engine";
import { SEASONS } from "../core/realm";
import { CHAINING_UNLOCK, COMPOUND_UNLOCK } from "../core/unlocks";
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
const LINE_HINTS = "type · tab complete · enter issue · esc close";
const NUMBER_HELP = "a number, such as 2 or 0.5";
const NUMBER = /^-?\d+(\.\d+)?(e[+-]?\d+)?$/;
const NUMBER_PREFIX = /^-?\d*\.?\d*(e[+-]?\d*)?$/;

type Choice<T> = { text: string; description: string; value: T };
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
		what: string,
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
			const problem = options.unmatched?.(word) ?? `"${word}" is not ${what}`;
			throw new Halt([], problem, null);
		}
		if (rest === best.text && options.final !== true) {
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

	number(): number {
		const rest = this.skipSpaces();
		if (rest === "") throw new Halt([], null, NUMBER_HELP);
		const word = rest.split(" ")[0] ?? rest;
		const typing = word.length === rest.length;
		if (typing && NUMBER_PREFIX.test(word)) {
			throw new Halt([], null, NUMBER_HELP);
		}
		const value = Number(word);
		if (!NUMBER.test(word) || !Number.isFinite(value)) {
			throw new Halt([], `"${word}" is not a number`, null);
		}
		this.position += word.length;
		return value === 0 ? 0 : value;
	}

	fail(problem: string): never {
		throw new Halt([], problem, null);
	}

	finish(): void {
		const rest = this.skipSpaces();
		if (rest !== "") {
			this.fail(`"${rest}" does not belong after a complete command`);
		}
	}
}

type Verb = {
	word: string;
	description: string;
	parse: (cursor: Cursor, context: MenuContext) => Command;
};

type Scope = {
	context: MenuContext;
	compound: boolean;
	chaining: boolean;
	ownId: string;
};

const PETITION_HELP: Readonly<Record<Petition, string>> = {
	harvest: "what to do with the grain surplus",
	wood: "what to do with the wood",
	ore: "what to do with the ore",
	labor: "where the peasants work",
};

const QUANTITY_HELP: Readonly<Record<Quantity, string>> = {
	coin: "coin in the treasury",
	grain: "grain in store",
	grainSeasons: "seasons the stores would feed everyone",
	idle: "peasants with no job",
	ore: "ore in store",
	population: "peasants in the village",
	wood: "wood in store",
};

const COMPARISONS: readonly Choice<"above" | "below">[] = [
	{ text: "above", description: "more than a number", value: "above" },
	{ text: "below", description: "less than a number", value: "below" },
];

type Subject =
	| { kind: "not" }
	| { kind: "season" }
	| { kind: "named"; quantity: Quantity | null; id: string | null };

function subjects(scope: Scope): Choice<Subject>[] {
	const byText = new Map<string, Choice<Subject>>();
	for (const quantity of QUANTITIES) {
		byText.set(words(quantity), {
			text: words(quantity),
			description: QUANTITY_HELP[quantity],
			value: { kind: "named", quantity, id: null },
		});
	}
	byText.set("it is", {
		text: "it is",
		description: "the season",
		value: { kind: "season" },
	});
	if (scope.compound) {
		byText.set("not", {
			text: "not",
			description: "the condition that follows is false",
			value: { kind: "not" },
		});
	}
	if (scope.chaining) {
		for (const decree of scope.context.view.decrees) {
			if (decree.id === scope.ownId) continue;
			const existing = byText.get(decree.id);
			const description = `what the ${decree.petition} decree chose`;
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
			"a season",
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
			description: "the policy that decree picked this tick",
			value: "chose",
		});
	}
	const next = cursor.expect("above, below or chose", verbs);
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
	const policy = cursor.expect("a policy that decree can choose", policies);
	return { kind: "chose", decree: id, policy: policy.value };
}

function parseAtom(cursor: Cursor, scope: Scope): Condition {
	const first = cursor.expect("a condition", subjects(scope)).value;
	if (first.kind !== "not") return parseBase(cursor, scope, first);
	const inner = cursor.expect("a condition", subjects(scope)).value;
	if (inner.kind === "not") return cursor.fail("not cannot be repeated");
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
		description: "the policy when no rule applies",
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

function parseDecreeVerb(cursor: Cursor, context: MenuContext): Command {
	const { view, tuning } = context;
	const petition = cursor.expect(
		"a petition",
		PETITIONS.map((value) => ({
			text: value,
			description: PETITION_HELP[value],
			value,
		})),
	).value;
	const active = view.decrees.find((decree) => decree.petition === petition);
	const scope: Scope = {
		context,
		compound: view.unlocks.includes(COMPOUND_UNLOCK),
		chaining: view.unlocks.includes(CHAINING_UNLOCK),
		ownId: active?.id ?? petition,
	};
	const { maxRules } = tuning.decrees;
	const tooMany = (rulesSoFar: number) => (word: string) =>
		rulesSoFar >= maxRules && policiesFor(petition, tuning).includes(word)
			? `a decree holds at most ${String(maxRules)} rules`
			: null;
	const when: Choice<null> = {
		text: "when",
		description: "the condition for this rule",
		value: null,
	};

	const rules: DecreeRule[] = [];
	let head = cursor.expect(
		"a policy or otherwise",
		startChoices(petition, 0, context),
		{ unmatched: tooMany(0) },
	).value;
	while (head.kind === "policy") {
		const { policy } = head;
		cursor.expect("when", [when]);
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
								? "every condition must hold"
								: "any condition may hold",
						value: { kind: "join", join: word },
					});
				}
			}
			const taken: "and" | "or" | null = join;
			next = cursor.expect(
				"and, or, a policy or otherwise",
				[...joins, ...startChoices(petition, rules.length + 1, context)],
				{
					unmatched: (word) => {
						if (scope.compound && (word === "and" || word === "or")) {
							if (!roomForAnother) return conditionLimitProblem(tuning);
							if (taken !== null) {
								return "a rule joins its conditions with and, or or, not both";
							}
						}
						return tooMany(rules.length + 1)(word);
					},
				},
			).value;
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

	const otherwise = cursor.expect("a policy", policyChoices(petition, tuning), {
		final: true,
	}).value;
	const decree: Decree = { id: scope.ownId, petition, rules, otherwise };
	try {
		parseDecree(decree, tuning.decrees);
	} catch (error) {
		cursor.fail(plainReason(error));
	}
	return { type: "enactDecree", decree };
}

function conditionLimitProblem(tuning: MenuContext["tuning"]): string {
	return `a rule holds at most ${String(tuning.decrees.maxConditionNodes)} condition parts, and a not counts as two`;
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
	if (decrees.length === 0) cursor.fail("no decrees are in force");
	const id = cursor.expect(
		"a decree in force",
		decrees.map((decree) => ({
			text: decree.id,
			description: formatDecree(decree),
			value: decree.id,
		})),
		{ final: true },
	).value;
	return { type: "repealDecree", id };
}

/** New verbs are appended here; each parses the rest of the line with the same cursor. */
const VERBS: readonly Verb[] = [
	{
		word: "decree",
		description: "set how a petition is answered",
		parse: parseDecreeVerb,
	},
	{
		word: "repeal",
		description: "withdraw a decree in force",
		parse: parseRepealVerb,
	},
];

type Analysis = LineResult & { options: Option[]; expecting: string | null };

function analyze(text: string, context: MenuContext): Analysis {
	const cursor = new Cursor(text);
	try {
		const verb = cursor.expect(
			"a command",
			VERBS.map((value) => ({
				text: value.word,
				description: value.description,
				value,
			})),
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

export function renderLine(state: LineState, context: MenuContext): MenuRender {
	const analysis = analyze(state.text, context);
	const { suggestions } = analysis;
	const highlight = Math.min(
		state.highlight,
		Math.max(0, suggestions.length - 1),
	);
	const first = Math.max(0, highlight - (MAX_SUGGESTIONS_SHOWN - 1));
	const shown = suggestions.slice(first, first + MAX_SUGGESTIONS_SHOWN);
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
	lines.push("");
	const inForce = context.view.decrees;
	if (inForce.length === 0) lines.push("No decrees are in force.");
	else lines.push(...inForce.map(formatDecree));
	return { title: "Command", lines, hints: LINE_HINTS };
}

function atomText(condition: Condition): string {
	switch (condition.kind) {
		case "compare":
			return `${words(condition.quantity)} ${condition.comparison} ${String(condition.value)}`;
		case "season":
			return `it is ${condition.season}`;
		case "chose":
			return `${condition.decree} chose ${condition.policy}`;
		default:
			throw new Error("this condition cannot be written on the command line");
	}
}

function conditionText(condition: Condition): string {
	switch (condition.kind) {
		case "not":
			return `not ${atomText(condition.condition)}`;
		case "all":
		case "any": {
			if (condition.conditions.length < 2) {
				throw new Error("a compound condition needs at least two conditions");
			}
			const word = condition.kind === "all" ? " and " : " or ";
			return condition.conditions
				.map((child) =>
					child.kind === "not" ? conditionText(child) : atomText(child),
				)
				.join(word);
		}
		default:
			return atomText(condition);
	}
}

/**
 * The text that builds `decree`. `parseLine` rebuilds the same decree only when `decree.id` is the id the
 * parser would choose: the id of the decree in force for that petition, else the petition's name.
 * Throws for a decree the grammar cannot say (nested compound conditions, a compound with fewer than two
 * parts, or a policy the petition lacks), so callers must catch.
 */
export function decreeLine(
	decree: Decree,
	tuning: MenuContext["tuning"],
): string {
	const known = policiesFor(decree.petition, tuning);
	for (const policy of [
		...decree.rules.map((r) => r.policy),
		decree.otherwise,
	]) {
		if (!known.includes(policy)) {
			throw new Error(`"${policy}" is not a ${decree.petition} policy`);
		}
	}
	const rules = decree.rules
		.map((rule) => `${rule.policy} when ${conditionText(rule.when)}`)
		.join(", ");
	const middle = rules === "" ? "" : `${rules} `;
	return `decree ${decree.petition} ${middle}otherwise ${decree.otherwise}`;
}
