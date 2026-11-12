import type { Command } from "../core/commands";
import { copy } from "../core/copy";
import { CONJURABLE } from "../core/illusion";
import { Job, RESOURCES, type Resource } from "../core/realm";
import {
  ARCHIVE_PANEL,
  CONJURING,
  CROWN_PANEL,
  DECREES_PANEL,
  FORGING,
  PALETTE_UNLOCK,
  SAVED_DECREES_UNLOCK,
  type UnlockId,
} from "../core/unlocks";
import {
  type Choice,
  Cursor,
  Halt,
  type Option,
  type Suggestion,
} from "./command-cursor";
import { formatDecree } from "./decree-format";
import { parseDecreeVerb } from "./decree-grammar";
import { formatCost } from "./format";
import type { KeyPress } from "./keys";
import { entryLabel, type MenuContext, type MenuRender } from "./menu";
import { editedText, promptLine } from "./text-edit";

export type LineState = { text: string; highlight: number };
export type LineResult = {
  suggestions: Suggestion[];
  command: Command | null;
  problem: string | null;
};

const MAX_SUGGESTIONS_SHOWN = 6;

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

function slugOf(id: UnlockId): string {
  return id
    .slice(id.indexOf(".") + 1)
    .replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function parseBuyVerb(cursor: Cursor, context: MenuContext): Command {
  const { entries } = context.view.archive;
  if (entries.length === 0) cursor.fail(copy.commandLine.nothingToBuyYet);
  const id = cursor.expect(
    copy.commandLine.expected.archiveEntryToBuy,
    entries.map((entry) => {
      const help = {
        label: entry.label,
        cost: formatCost(entry.cost),
        description: entry.description,
      };
      const short = entry.cost
        .filter((part) => !part.affordable)
        .map((part) => ({
          resource: part.resource,
          amount: Math.ceil(part.amount - part.held),
        }));
      return {
        text: slugOf(entry.id),
        description: entry.affordable
          ? copy.commandLine.archiveEntryHelp(help)
          : copy.commandLine.archiveEntryShortHelp({
              ...help,
              shortfall: formatCost(short),
            }),
        value: entry.id,
      };
    }),
    {
      final: true,
      unmatched: (word) => {
        const known = context.tuning.archive.entries.find(
          (entry) => slugOf(entry.id) === word,
        );
        if (known === undefined) return null;
        if (ownsUnlock(context, known.id))
          return copy.commandLine.alreadyOwn({ label: known.label });
        const missing = known.requires
          .filter((required) => !ownsUnlock(context, required))
          .map((required) => entryLabel(context, required));
        return missing.length === 0
          ? null
          : copy.commandLine.needsFirst({
              label: known.label,
              missing: missing.join(" and "),
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

const forgingVerb = (verb: string) => ({
  available: (context: MenuContext) => ownsUnlock(context, FORGING),
  unavailableProblem: () => copy.commandLine.needsForging({ verb }),
});

/** Repaying stays open to anyone who owes, however the debt arose. */
const backVerbGate = {
  available: (context: MenuContext) =>
    Object.values(context.view.illusion?.debt ?? {}).some(
      (debt) => debt.owed > 0,
    ),
  unavailableProblem: () => copy.commandLine.needsDebt,
};

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
    ...needsUnlock(DECREES_PANEL, "decree"),
    parse: (cursor, context) =>
      parseDecreeVerb(cursor, context, (decree) => ({
        type: "enactDecree",
        decree,
      })),
  },
  {
    word: "repeal",
    description: copy.commandLine.verbHelp.repeal,
    ...needsUnlock(DECREES_PANEL, "repeal"),
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
    ...forgingVerb("forge"),
    parse: () => ({ type: "forge" }),
  },
  {
    word: "forge missing",
    bare: true,
    description: copy.commandLine.verbHelp.forgeMissing,
    ...forgingVerb("forge missing"),
    parse: () => ({ type: "forgeMissing" }),
  },
  {
    word: "back",
    description: copy.commandLine.verbHelp.back,
    ...backVerbGate,
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
  }
  const text = editedText(state.text, key);
  if (text === null) return stay;
  return { state: openLine(text), commands: [] };
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
  const lines = [promptLine(state.text)];
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
