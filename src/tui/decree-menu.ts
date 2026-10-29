import {
	type Condition,
	type Decree,
	type DecreeRule,
	PETITIONS,
	type Petition,
	QUANTITIES,
} from "../core/decree";
import { policiesFor } from "../core/decree-engine";
import { SEASONS } from "../core/realm";
import { formatDecree, formatRule, words } from "./decree-format";
import type { MenuContext, MenuItem, Screen, ScreenBuilder } from "./menu";

type Draft = {
	petition: Petition;
	rules: DecreeRule[];
	otherwise: string | null;
};

const BUILDABLE = new Set(["compare", "season"]);

function activeFor(
	context: MenuContext,
	petition: Petition,
): Decree | undefined {
	return context.view.decrees.find((decree) => decree.petition === petition);
}

function otherwiseOf(draft: Draft, context: MenuContext): string {
	return (
		draft.otherwise ?? policiesFor(draft.petition, context.tuning)[0] ?? ""
	);
}

function pick<T extends string>(
	title: string,
	options: readonly T[],
	chosen: (option: T) => ScreenBuilder,
	label: (option: T) => string = (option) => option,
): ScreenBuilder {
	return () => ({
		kind: "list",
		title,
		items: options.map((option) => ({
			label: label(option),
			action: { kind: "push", screen: chosen(option) },
		})),
	});
}

function draftScreen(draft: Draft): ScreenBuilder {
	return (context): Screen => {
		const { petition } = draft;
		const otherwise = otherwiseOf(draft, context);
		const active = activeFor(context, petition);
		const notes = draft.rules.map(
			(rule, index) => `${String(index + 1)}. ${formatRule(rule)}`,
		);
		if (notes.length === 0) notes.push("No rules yet.");
		if (active?.rules.some((rule) => !BUILDABLE.has(rule.when.kind))) {
			notes.push(
				`Enacting will replace "${active.id}", whose rules this menu cannot build.`,
			);
		}
		const full = draft.rules.length >= context.tuning.decrees.maxRules;
		const decree: Decree = {
			id: active?.id ?? petition,
			petition,
			rules: draft.rules,
			otherwise,
		};
		const items: MenuItem[] = [
			{
				label: "Add rule",
				disabled: full,
				action: { kind: "push", screen: kindScreen(draft) },
			},
			{
				label: "Remove last rule",
				disabled: draft.rules.length === 0,
				action: {
					kind: "replace",
					pop: 1,
					screen: draftScreen({ ...draft, rules: draft.rules.slice(0, -1) }),
				},
			},
			{
				label: `Otherwise: ${otherwise}`,
				action: { kind: "push", screen: otherwiseScreen(draft) },
			},
			{
				label: "Enact",
				action: {
					kind: "command",
					command: { type: "enactDecree", decree },
					after: "close",
				},
			},
		];
		return { kind: "list", title: `Enact ${petition} decree`, notes, items };
	};
}

function otherwiseScreen(draft: Draft): ScreenBuilder {
	return (context) => ({
		kind: "list",
		title: "Otherwise",
		items: policiesFor(draft.petition, context.tuning).map((policy) => ({
			label: policy,
			action: {
				kind: "replace",
				pop: 2,
				screen: draftScreen({ ...draft, otherwise: policy }),
			},
		})),
	});
}

// `pops` counts the screens above the draft screen, the policy screen included.
function policyScreen(
	draft: Draft,
	when: Condition,
	pops: number,
): ScreenBuilder {
	return (context) => ({
		kind: "list",
		title: "Then choose",
		items: policiesFor(draft.petition, context.tuning).map((policy) => ({
			label: policy,
			action: {
				kind: "replace",
				pop: pops + 1,
				screen: draftScreen({
					...draft,
					rules: [...draft.rules, { when, policy }],
				}),
			},
		})),
	});
}

function kindScreen(draft: Draft): ScreenBuilder {
	return () => ({
		kind: "list",
		title: "Add rule: condition",
		items: [
			{
				label: "A quantity is above or below a number",
				action: { kind: "push", screen: quantityScreen(draft) },
			},
			{
				label: "It is a given season",
				action: { kind: "push", screen: seasonScreen(draft) },
			},
		],
	});
}

function seasonScreen(draft: Draft): ScreenBuilder {
	return pick("Season", SEASONS, (season) =>
		policyScreen(draft, { kind: "season", season }, 3),
	);
}

function quantityScreen(draft: Draft): ScreenBuilder {
	return pick(
		"Quantity",
		QUANTITIES,
		(quantity) =>
			pick("Comparison", ["above", "below"] as const, (comparison) => () => ({
				kind: "number",
				title: `${words(quantity)} ${comparison}`,
				onAccept: (value) => ({
					kind: "push",
					screen: policyScreen(
						draft,
						{ kind: "compare", quantity, comparison, value },
						5,
					),
				}),
			})),
		words,
	);
}

const repealScreen: ScreenBuilder = (context) => ({
	kind: "list",
	title: "Repeal",
	notes: context.view.decrees.length === 0 ? ["No decrees are in force."] : [],
	items: context.view.decrees.map((decree) => ({
		label: formatDecree(decree),
		action: {
			kind: "command",
			command: { type: "repealDecree", id: decree.id },
			after: "pop",
		},
	})),
});

export const decreeMenu: ScreenBuilder = (context) => {
	const decrees = context.view.decrees;
	const notes =
		decrees.length === 0
			? ["No decrees are in force."]
			: decrees.map(formatDecree);
	const items: MenuItem[] = PETITIONS.map((petition) => ({
		label: `Enact ${petition} decree…`,
		action: {
			kind: "push",
			screen: draftScreen({ petition, rules: [], otherwise: null }),
		},
	}));
	items.push({
		label: "Repeal…",
		action: { kind: "push", screen: repealScreen },
	});
	return { kind: "list", title: "Decrees", notes, items };
};
