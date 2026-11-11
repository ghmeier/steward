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
  commandLine: {},
  decrees: {},
} as const;
