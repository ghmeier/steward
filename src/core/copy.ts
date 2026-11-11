/**
 * Every hardcoded line of player-facing wording lives here, so a writer can read and edit the game's
 * voice in one file. Content text lives in `data/*.json` instead: the crown's lines, the desk templates
 * and the Archive's labels and names.
 *
 * Static text is a string. Text that needs values is a function taking one named-argument object,
 * so the template reads like the sentence it produces. Arguments arrive already formatted, or as plain
 * numbers when the copy decides the grammar. Number formatting stays with the callers, because core
 * cannot import the text interface's helpers. Prose that names a key takes the key as an argument,
 * so a rebinding never leaves a stale letter in a sentence.
 */

export function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export const copy = {
  crown: {
    noDemand: "the crown has made no demand",
    villageHoldsNone: ({ resource }: { resource: string }) =>
      `the village holds no ${resource}`,
  },
  illusion: {
    cannotConjureYet: "you cannot conjure yet",
    cannotBeConjured: ({ resource }: { resource: string }) =>
      `${resource} cannot be conjured`,
    conjureAmountMustBePositive: "the amount to conjure must be positive",
    ceilingLeavesRoomFor: ({ coin }: { coin: string }) =>
      `the ceiling leaves room for only ${coin} coin of illusion`,
    cannotForgeYet: "you cannot forge reports yet",
    ceilingLeavesNoRoom: "the ceiling leaves no room for a report",
    nothingToBackYet: "you have no illusions to back yet",
    noDebtToBack: ({ resource }: { resource: string }) =>
      `there is no ${resource} debt to back`,
    villageHoldsNoneToBack: ({ resource }: { resource: string }) =>
      `the village holds no ${resource} to back it`,
  },
  desk: {
    noDispute: ({ entryId }: { entryId: number }) => `no dispute ${entryId}`,
    noSuchOption: ({
      entryId,
      optionId,
    }: {
      entryId: number;
      optionId: string;
    }) => `dispute ${entryId} has no option "${optionId}"`,
    notEnough: ({
      resource,
      need,
      have,
    }: {
      resource: string;
      need: string;
      have: string;
    }) => `not enough ${resource} (need ${need}, have ${have})`,
    notEnoughReal: ({
      resource,
      need,
      have,
    }: {
      resource: string;
      need: string;
      have: string;
    }) => `not enough real ${resource} (need ${need}, have ${have})`,
    noRoomForPeasant: "the village has no room for another peasant",
  },
  notices: {
    archiveOpens: ({ key }: { key: string }) =>
      `The Archive opens. Press ${key} to buy.`,
    conjuringOpens: ({ key }: { key: string }) =>
      `You have learned conjuring. Press ${key} to focus the Ledger, which will believe anything you tell it.`,
    bought: ({ label }: { label: string }) => `Bought ${label}.`,
    unlocked: ({ label }: { label: string }) => `${label} unlocked.`,
    oneSeasonLeft: ({
      amount,
      resource,
    }: {
      amount: string;
      resource: string;
    }) => `One season left to deliver ${amount} ${resource} to the crown.`,
    auditorsOnTheRoad: ({ wait }: { wait: string }) =>
      `Auditors are on the road and due in about ${wait}. Repay what you can before they count it.`,
    // Names beyond the first two are folded into a count so the line stays short in the footer.
    starved: ({
      names,
      deaths,
    }: {
      names: readonly string[];
      deaths: number;
    }) => {
      if (names.length === deaths && names.length === 1) {
        return `${names[0]} starved.`;
      }
      if (names.length === deaths && names.length === 2) {
        return `${names[0]} and ${names[1]} starved.`;
      }
      const listed = names.slice(0, 2);
      const others = deaths - listed.length;
      return `${listed.join(", ")} and ${others} ${plural(others, "other", "others")} starved.`;
    },
  },
  ledger: {},
  village: {},
  court: {},
  menus: {},
  help: {},
  keys: {},
  commandLine: {
    title: "Command",
    hints: "type · tab complete · enter issue · esc close",
    numberHelp: "a number, such as 2 or 0.5",
    nameHelp: "a name for the decree, such as harvest-plan",
    expected: {
      command: "a command",
      petition: "a petition",
      policyOrOtherwise: "a policy or otherwise",
      when: "when",
      condition: "a condition",
      season: "a season",
      comparisonOrChose: "above, below or chose",
      policyThatDecreeCanChoose: "a policy that decree can choose",
      joinPolicyOrOtherwise: "and, or, a policy or otherwise",
      policy: "a policy",
      number: "a number",
      decree: "decree",
      decreeInForce: "a decree in force",
      archiveEntryToBuy: "an Archive entry you can buy",
      savedDecree: "a saved decree",
      peasant: "a peasant",
      job: "a job",
      resourceToConjure: "a resource that can be conjured",
      resource: "a resource",
    },
    notExpected: ({ word, expected }: { word: string; expected: string }) =>
      `"${word}" is not ${expected}`,
    invalidName: ({ word }: { word: string }) =>
      `"${word}" is not a valid name: use lowercase letters, digits and dashes, starting with a letter`,
    doesNotBelong: ({ rest }: { rest: string }) =>
      `"${rest}" does not belong after a complete command`,
    owedNeedsEntry: ({ label }: { label: string }) =>
      `owed quantities need "${label}" from the Archive`,
    notRepeated: "not cannot be repeated",
    tooManyRules: ({ maxRules }: { maxRules: string }) =>
      `a decree holds at most ${maxRules} rules`,
    tooManyConditionParts: ({ maxParts }: { maxParts: string }) =>
      `a rule holds at most ${maxParts} condition parts, and a not counts as two`,
    mixedJoins: "a rule joins its conditions with and, or or, not both",
    noDecreesInForce: "no decrees are in force",
    noDecreesSaved: "no decrees are saved",
    noSavedDecreesToForget: "there are no saved decrees to forget",
    ownEverything: "you own everything in the Archive",
    nothingToBuyYet: "nothing in the Archive can be bought yet",
    alreadyOwn: ({ label }: { label: string }) => `you already own ${label}`,
    needsFirst: ({ label, missing }: { label: string; missing: string }) =>
      `${label} needs ${missing} first`,
    needsArchive: ({ verb }: { verb: string }) =>
      `${verb} needs the Archive, which opens when the treasury first holds coin`,
    needsEntry: ({ verb, label }: { verb: string; label: string }) =>
      `${verb} needs "${label}" from the Archive`,
    needsConjuring: ({ verb }: { verb: string }) =>
      `${verb} needs conjuring, which the crown teaches you with its first demand`,
    needsCrown: "deliver needs the Crown, which opens at promotion",
    archiveEntryHelp: ({
      label,
      cost,
      description,
    }: {
      label: string;
      cost: string;
      description: string;
    }) => `${label}, ${cost} coin: ${description}`,
    archiveEntryShortHelp: ({
      label,
      cost,
      description,
      shortfall,
    }: {
      label: string;
      cost: string;
      description: string;
      shortfall: string;
    }) => `${label}, ${cost} coin: ${description} (need ${shortfall} coin)`,
    namedDecreeHelp: ({ petition }: { petition: string }) =>
      `what the ${petition} decree chose`,
    verbHelp: {
      decree: "set how a petition is answered",
      repeal: "withdraw a decree in force",
      buy: "buy an entry from the Archive",
      save: "keep a decree under a name",
      enact: "enact a saved decree",
      forget: "delete a saved decree",
      assign: "give a peasant a job",
      deliver: "hand the crown what it demands from the stores",
      conjure: "add stock that does not exist, grain or coin only",
      forge: "report the open crown demand as delivered, on paper",
      back: "repay one resource's debt from real stock",
    },
    keywordHelp: {
      above: "more than a number",
      below: "less than a number",
      chose: "the policy that decree picked this tick",
      otherwise: "the policy when no rule applies",
      when: "the condition for this rule",
      and: "every condition must hold",
      or: "any condition may hold",
      not: "the condition that follows is false",
      itIs: "the season",
      decree: "the decree to keep",
    },
    petitionHelp: {
      harvest: "what to do with the grain surplus",
      wood: "what to do with the wood",
      ore: "what to do with the ore",
      labor: "where the peasants work",
    },
    quantityHelp: {
      coin: "coin in the treasury",
      debt: "coin value of the illusion passed off as real",
      grain: "grain in store",
      grainSeasons: "seasons the stores would feed everyone",
      idle: "peasants with no job",
      ore: "ore in store",
      owedCoin: "coin the crown still demands",
      owedGrain: "grain the crown still demands",
      owedOre: "ore the crown still demands",
      owedWood: "wood the crown still demands",
      population: "peasants in the village",
      wood: "wood in store",
    },
    jobHelp: {
      farm: "grow grain",
      forest: "cut wood",
      mine: "dig ore",
      idle: "no work",
    },
    resourceHelp: {
      coin: "the treasury",
      grain: "the granary",
      ore: "the mine's output",
      wood: "the forest's output",
    },
  },
  decrees: {},
} as const;
