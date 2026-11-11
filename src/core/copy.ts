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
  help: {
    title: "Help",
    scrollHints: "j/k scroll · space page · esc close",
    topics: {
      keys: "Keys",
      grain: "Grain and growth",
      coin: "Coin",
      woodAndOre: "Wood and ore",
      decrees: "Decrees",
      harvestAndLabor: "Harvest and labor",
      desk: "The desk",
      promotion: "Promotion",
      crown: "Crown",
      illusion: "Illusion",
    },
    keys: {
      panelRowLabel: ({ panel }: { panel: string }) => `${panel}:`,
      arrowsLabel: "panels",
      focusPanels:
        "Press a panel's letter to focus it; esc leaves it. While a panel is focused its keys win:",
      inMenus: "In any menu: up/down to move, enter to choose, esc to go back.",
      assignJobs: ({
        farmKey,
        forestKey,
        mineKey,
        idleKey,
      }: {
        farmKey: string;
        forestKey: string;
        mineKey: string;
        idleKey: string;
      }) =>
        `${farmKey}, ${forestKey}, ${mineKey} and ${idleKey} put the selected peasant on the farm, in the forest, in the mine or idle, once Peasants is focused.`,
    },
    grain: {
      seasonYield: ({ season, rate }: { season: string; rate: string }) =>
        `${season} ${rate}`,
      farmersGrow: ({ yields }: { yields: string }) =>
        `Farmers grow grain, per farmer: ${yields}.`,
      peasantsEat: ({ rate, feeds }: { rate: string; feeds: string }) =>
        `Every peasant eats ${rate}, so over a year one farmer feeds about ${feeds} peasants.`,
      seasonLasts: ({ duration }: { duration: string }) =>
        `A season lasts ${duration}.`,
      barrenSeasons: ({ seasons }: { seasons: string }) =>
        `${seasons} grows nothing, so store grain before it.`,
      noHarvestCost: ({ grain }: { grain: string }) =>
        `A season with no harvest costs each peasant ${grain} grain, so the stores must grow with the village.`,
      seasonsRuleAdvice:
        "That is why rules on grain seasons are safer than rules on a fixed amount of grain.",
      famine: ({ duration }: { duration: string }) =>
        `Once the stores are empty, a famine takes at most half the village, spread over a season (${duration}), idle peasants first.`,
      famineEnds: "The famine ends as soon as everyone eats again.",
      newPeasants: ({ grain }: { grain: string }) =>
        `New peasants come only from feeding: every ${grain} grain fed makes one,`,
      populationCap: ({ maxPopulation }: { maxPopulation: string }) =>
        `up to ${maxPopulation} peasants. Only grain can be fed.`,
      feedingThroughDecree:
        "Feeding happens through a harvest decree (see Harvest and labor).",
    },
    coin: {
      steadySource: ({
        grainPrice,
        woodPrice,
        orePrice,
      }: {
        grainPrice: string;
        woodPrice: string;
        orePrice: string;
      }) =>
        `The only steady source of coin is selling: grain at ${grainPrice} coin each, wood at ${woodPrice} and ore at ${orePrice}.`,
      sellingThroughDecree:
        "Selling happens through a harvest, wood or ore decree (see Harvest and labor).",
      merchantsPay: "Merchants and some rulings pay coin as well.",
      spentOn: "Coin is spent on rulings and on merchants' wares.",
      archiveBuys: ({ key }: { key: string }) =>
        `Coin also buys entries from the Archive (press ${key}).`,
    },
    woodAndOre: {
      woodCut: ({ rate }: { rate: string }) =>
        `Foresters cut wood at ${rate} each.`,
      oreDug: ({ rate }: { rate: string }) => `Miners dig ore at ${rate} each.`,
      woodPays: "Wood pays for some rulings and merchants' wares.",
      woodNoUse: "Wood has no use yet.",
      orePays: "Ore pays for some rulings and merchants' wares.",
      oreNoUse: "Ore has no use yet.",
      prices: ({
        woodPrice,
        orePrice,
      }: {
        woodPrice: string;
        orePrice: string;
      }) =>
        `Wood sells for ${woodPrice} coin and ore for ${orePrice}, through a wood or ore decree (see Harvest and labor).`,
    },
    decrees: {
      petitions:
        "A decree answers one of four petitions, harvest (grain), wood, ore or labor, and each petition holds one decree.",
      ruleOrder:
        "Rules are checked in order and the first match wins. Otherwise applies when none match.",
      grainSeasonsMeaning:
        '"Grain seasons" is how many seasons the stores would feed everyone.',
      howToIssue: ({ key }: { key: string }) =>
        `Press ${key} to focus Decrees, then enter on a petition and type the decree: tab completes a word, enter issues it. A new decree replaces the one for its petition.`,
      harvestExample:
        "Example, a harvest decree: decree harvest sell when grain seasons above 3, feed when grain seasons above 2 otherwise stockpile",
      exampleAboveThree:
        "  While the stores are above 3 seasons, each tick's new surplus is sold.",
      exampleBetween:
        "  Between 2 and 3 it is fed, to grow the village. Below 2 it is kept.",
      exampleBothMatch:
        "  At 3.5 seasons both rules match, and sell wins by coming first.",
      exampleSwapped:
        "  Swap them and feed catches everything above 2, so nothing is ever sold.",
      withdraw: ({ key }: { key: string }) =>
        `To withdraw a decree, focus Decrees, select its petition and press ${key}.`,
      compound:
        "Join conditions with and, or or (one kind per rule), and put not before one to flip it.",
      chaining:
        'A condition can read another decree, as in "harvest chose sell".',
      saved:
        "Keep a decree with: save <name> decree ... Then enact <name> brings it back, and forget <name> deletes it.",
    },
    harvestAndLabor: {
      eachTick:
        "Harvest, wood and ore: each tick, a decree feeds (grain only), sells or stockpiles that resource.",
      exception:
        '  Exception: a rule like "sell when wood above 50" (the decree\'s own resource, above a number)',
      exceptionActsOn:
        "  acts on everything above that number, so it brings the stock back down to 50 at once.",
      otherwiseActsOn:
        "  Any other rule, and otherwise, acts on only that tick's new production (for grain, the surplus beyond what everyone eats).",
      noDecree: "  With no decree for a resource, it is stockpiled.",
      laborMoves: ({ moves }: { moves: number }) =>
        `Labor: each tick, ${moves} ${plural(moves, "peasant moves", "peasants move")} toward a split of farm, forest and mine:`,
      laborChangesOnly:
        "  A labor decree moves peasants when its policy changes, and your hand assignments stay until then.",
      laborExample:
        "Example, a labor decree: decree labor mine when it is winter otherwise farm",
    },
    desk: {
      arrivals: ({
        shortestWait,
        longestWait,
        slots,
      }: {
        shortestWait: string;
        longestWait: string;
        slots: string;
      }) =>
        `Something arrives on the desk every ${shortestWait} to ${longestWait}, onto a desk of ${slots} slots. It is a dispute between two peasants, a merchant with an offer, or a traveller asking to settle.`,
      overflow:
        "When the desk overflows, the oldest entry takes its default answer, and the merchant or traveller moves on.",
      rulingCost: "A ruling can cost stores, or make one party sulk.",
      sulking: ({ duration }: { duration: string }) =>
        `A sulking peasant produces nothing and refuses a job, for ${duration}.`,
      merchantsAndTravellers:
        "A merchant trades at his own price, so check it against the market. A traveller who settles costs grain and adds one peasant, if the village has room.",
      disputeDropped:
        "A dispute is dropped if one of its parties dies. Merchants and travellers wait their turn.",
      openDesk: ({ key }: { key: string }) =>
        `Press ${key} to open the desk and answer what is waiting.`,
    },
    promotion: {
      reach: ({ population }: { population: string }) =>
        `Reach ${population} peasants and the crown notices you.`,
      once: "Promotion happens once, and it is not taken back.",
    },
    crown: {
      firstDemand: ({ wait }: { wait: string }) =>
        `After promotion the crown makes one demand at a time, the first ${wait} later: an amount of grain, wood, ore or coin, never the same resource twice running.`,
      deadline: ({
        deadline,
        shortestGap,
        longestGap,
      }: {
        deadline: string;
        shortestGap: string;
        longestGap: string;
      }) =>
        `Each demand has a deadline of ${deadline}, and a new one follows ${shortestGap} to ${longestGap} after each is settled.`,
      deliver: ({ key }: { key: string }) =>
        `Press ${key} to focus the Crown, then enter to deliver whatever the stores hold toward the demand. Partial deliveries add up.`,
      reward: ({ reward }: { reward: string }) =>
        `Paying in full before the deadline earns ${reward} of the amount back in coin.`,
      collection:
        "At the deadline the crown collects what is still owed from the stores. If they cannot cover it, the demand is missed.",
      missAndStep: ({ surcharge, step }: { surcharge: string; step: string }) =>
        `A miss adds ${surcharge} of the shortfall to the next demand, and every demand met raises later amounts by ${step} of the base.`,
      correspondence: ({ label, cost }: { label: string; cost: string }) =>
        `${label} (Archive, ${cost} coin) lets decrees read what is owed, as in "owed ore above 0".`,
      commandLine: "The command line also takes deliver.",
    },
    illusion: {
      teaches: ({ lot }: { lot: string }) =>
        `The crown's first demand teaches conjuring: stock the Ledger counts and the stores do not hold. Only grain and coin can be conjured, ${lot} at a time.`,
      conjure: ({ key }: { key: string }) =>
        `Press ${key} to focus the Ledger, then enter to conjure a lot of the selected resource. The command line takes conjure <grain or coin> <amount>.`,
      outsiders:
        "Only outsiders accept it: the crown, merchants and the Archive. Peasants cannot eat it and decrees cannot sell it. A payment uses conjured stock first, then real stock.",
      fades: ({ fade }: { fade: string }) =>
        `It fades, by about ${fade} a season.`,
      debt: ({ growth, forgeKey }: { growth: string; forgeKey: string }) =>
        `Whatever is passed off to an outsider becomes debt, and debt grows by about ${growth} a season. Press ${forgeKey} in the Crown panel to forge a report: it marks what is still owed as delivered, in any resource, and the forged amount becomes debt. The command line takes forge.`,
      ceiling: ({
        ceiling,
        grainAndWoodPrice,
        oreAndCoinPrice,
      }: {
        ceiling: string;
        grainAndWoodPrice: string;
        oreAndCoinPrice: string;
      }) =>
        `Illusion and debt together may not pass ${ceiling} coin per peasant, counting grain and wood at ${grainAndWoodPrice} coin, ore and coin at ${oreAndCoinPrice}.`,
      books: ({ strained, rotten }: { strained: string; rotten: string }) =>
        `The Ledger shows the state of the books in one word: clean with nothing outstanding, thin, strained from ${strained} of the ceiling and rotten from ${rotten}.`,
      repay: ({ key }: { key: string }) =>
        `To repay, select a resource in the Ledger and press ${key}, or type back <resource>. Debt is repaid from real stock, at any time.`,
      auditors: ({
        debtShare,
        seasons,
        warning,
        deadline,
      }: {
        debtShare: string;
        seasons: string;
        warning: string;
        deadline: string;
      }) =>
        `Auditors are sent when debt reaches ${debtShare} of the ceiling, or when any debt is ${seasons} seasons old. They arrive ${warning} after the warning and wait ${deadline} on the desk.`,
      outcomes: ({ cost, growth }: { cost: string; growth: string }) =>
        `The desk offers three outcomes: back the debt from real stock, a deeper illusion that costs real coin worth ${cost} of the debt and multiplies it by ${growth}, or let the deadline pass.`,
      deadlinePasses:
        "If the deadline passes, the auditors seize real stock toward the debt and the debt is cleared. If the stores cannot cover it, the crown counts a missed demand.",
    },
  },
  keys: {
    hints: {
      ledger: "ledger",
      peasants: "peasants",
      archive: "archive",
      court: "court",
      decrees: "decrees",
      crown: "crown",
      commands: "commands",
      save: "save",
      newVillage: "new village",
      help: "help",
      quit: "quit",
    },
    panelActions: {
      select: "select",
      conjure: "conjure",
      repay: "repay",
      assign: "assign",
      buy: "buy",
      choose: "choose",
      write: "write",
      repeal: "repeal",
      deliver: "deliver",
      forge: "forge",
      back: "back",
    },
    barHints: "(?)Help (N)ew village (Q)uit",
    barCommands: ": commands",
  },
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
