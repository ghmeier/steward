import type { Job, Trait } from "./realm";

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

/** The numbers a trait's help line quotes, each already formatted from tuning. */
export type TraitFigures = {
  outputChange: string;
  reportRise: string;
  limit: string;
};

// Adjectives, so a list of them reads both in the sentences that describe a candidate and on a governor's row.
const TRAIT_WORDS: Record<Trait, string> = {
  braggart: "boastful",
  diligent: "diligent",
  "empire-builder": "ambitious",
  hoarder: "tight-fisted",
  skimmer: "light-fingered",
};

export function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export const copy = {
  laborSplit: {
    unpaired:
      "a labor split names each job with a number, such as farm 60 forest 30",
    badWeight: ({ job, text }: { job: string; text: string }) =>
      `"${text}" is not a share for ${job}; use a number that is not negative, such as 60`,
    unknownJob: ({ job }: { job: string }) =>
      `"${job}" is not a job; a labor split uses farm, forest and mine`,
    duplicateJob: ({ job }: { job: string }) =>
      `${job} appears twice in the labor split`,
    allZero: "a labor split needs at least one job with a share above zero",
  },
  crown: {
    noDemand: "the crown has made no demand",
    villageHoldsNone: ({ resource }: { resource: string }) =>
      `the village holds no ${resource}`,
  },
  archive: {
    cannotAfford: ({ label, resource }: { label: string; resource: string }) =>
      `you do not have enough ${resource} to purchase ${label}`,
    notOffered: ({ label }: { label: string }) =>
      `the Archive is not offering ${label} yet`,
  },
  illusion: {
    conjureDone: ({ amount, resource }: { amount: string; resource: string }) =>
      `You conjure ${amount} ${resource}. It will fool the crown, the Archive and the Court, not the peasants.`,
    cannotConjureYet: "you have not bought conjuring from the Archive",
    cannotBeConjured: ({ resource }: { resource: string }) =>
      `${resource} cannot be conjured`,
    conjureAmountMustBePositive: "the amount to conjure must be positive",
    ceilingLeavesRoomFor: ({ coin }: { coin: string }) =>
      `the ceiling leaves room for only ${coin} coin of illusion`,
    cannotForgeYet: "you have not bought forging from the Archive",
    ceilingLeavesNoRoom: "the ceiling leaves no room for a report",
    noDebtToBack: ({ resource }: { resource: string }) =>
      `there is no ${resource} debt to back`,
    villageHoldsNoneToBack: ({ resource }: { resource: string }) =>
      `the village holds no ${resource} to back it`,
    figure: ({ amount, exact }: { amount: string; exact: boolean }) =>
      exact ? amount : `~${amount}`,
    repaidAll: ({ resource, repaid }: { resource: string; repaid: string }) =>
      `Repaid ${repaid} ${resource}; none is owed now.`,
    repaidPartly: ({
      resource,
      repaid,
      left,
    }: {
      resource: string;
      repaid: string;
      left: string;
    }) =>
      `Repaid ${repaid} ${resource}, all the real stock held; ${left} is still owed.`,
  },
  governors: {
    noRoomForGovernor: "the crown allows no more governors in the village",
    jobWords: {
      farm: "the farms",
      forest: "the forest",
      mine: "the mine",
      idle: "nothing in particular",
    } satisfies Record<Job, string>,
    traitList: ({ traits }: { traits: readonly Trait[] }) =>
      traits.map((trait) => TRAIT_WORDS[trait]).join(" and "),
    traitRowList: ({ traits }: { traits: readonly Trait[] }) =>
      traits.map((trait) => TRAIT_WORDS[trait]).join(", "),
    traitWords: TRAIT_WORDS,
  },
  desk: {
    noDispute: ({ entryId }: { entryId: number }) => `no dispute ${entryId}`,
    noEntryOfKind: ({ kind }: { kind: string }) =>
      `no ${kind} is waiting on the desk`,
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
      `The Archive opens. Press ${key} to see what it sells.`,
    courtOpens: ({ key }: { key: string }) =>
      `The Court opens. Press ${key} to hear what is waiting.`,
    decreesOpen: ({ key }: { key: string }) =>
      `You may now write decrees. Press ${key} to begin.`,
    charterOpens: ({ key }: { key: string }) =>
      `The Crown charter is yours. Press ${key} to focus the Crown, which will soon make its first demand.`,
    forgingOpens: ({ key }: { key: string }) =>
      `You have learned forging. Press ${key} in the Crown panel to report a demand as delivered on paper.`,
    conjuringOpens: ({ key }: { key: string }) =>
      `You have learned conjuring. Press ${key} to focus the Ledger, then enter to add stock it will believe.`,
    governorsOpen:
      "Governors may now be hired. Candidates will arrive on the Court's desk.",
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
    auditorsOnTheRoadUnknownWait:
      "Auditors are on the road, and you do not know when they arrive. Repay what you can before they count it.",
    governorRetired: ({ name }: { name: string }) =>
      `${name}'s term is over and they have retired from governing.`,
    governorDied: ({
      name,
      cause,
    }: {
      name: string;
      cause?: string | undefined;
    }) =>
      `${name} has died${cause === undefined ? "" : ` of ${cause}`}, and their village is gone with them.`,
    governorDismissed: ({ name }: { name: string }) =>
      `The failed audit fell on ${name}, who has been dismissed.`,
    governorHandedOver: ({ coin }: { coin: string }) =>
      `They handed over ${coin} coin they had kept back.`,
    startedNewGame: "Started a new game.",
    unsupportedSave: ({
      version,
      preservedAs,
    }: {
      version: string;
      preservedAs: string;
    }) =>
      `Save version ${version} is not supported; it was kept as ${preservedAs}. Started a new game.`,
    repealedStale: ({ decrees }: { decrees: string }) =>
      `Repealed ${decrees}: their policies no longer exist.`,
    saved: "Saved.",
    saveFailed: ({ error }: { error: string }) => `Save failed: ${error}`,
    newVillageFounded: "A new village is founded.",
    promoted: "The crown has noticed you. You are promoted to steward.",
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
  ledger: {
    time: ({ time }: { time: string }) => `Time  ${time}`,
    conjured: ({ amount }: { amount: string }) =>
      `(+${amount} conjured, fading)`,
    eaten: ({ rate }: { rate: string }) => `(${rate}/s eaten)`,
    stored: ({ amount, cap }: { amount: string; cap: string }) =>
      `${amount} / ${cap}`,
    titleLabel: "Title",
    title: ({ title, village }: { title: string; village: string }) =>
      `${title} of ${village}`,
    books: ({ books }: { books: string }) => `Books: ${books}`,
    owed: ({ figure }: { figure: string }) => `(owed ${figure})`,
    repayAll: ({ key }: { key: string }) => `(${key} repays it all)`,
    repayPart: ({ key, figure }: { key: string; figure: string }) =>
      `(${key} repays ${figure}, all it holds)`,
    repayNone: ({ resource }: { resource: string }) =>
      `(no real ${resource} to repay with)`,
    auditDue: ({ wait }: { wait: string }) => `Auditors due in ${wait}`,
    peasants: ({ population, idle }: { population: number; idle: number }) =>
      `Peasants ${population} (${idle} idle)`,
    labor: ({
      farm,
      forest,
      mine,
    }: {
      farm: number;
      forest: number;
      mine: number;
    }) => `Farm ${farm} Forest ${forest} Mine ${mine}`,
    season: ({ season }: { season: string }) => `Season ${season}`,
    promotionLabel: "Promotion",
    promotionProgress: ({
      population,
      target,
    }: {
      population: number;
      target: number;
    }) => `${population} / ${target} peasants`,
    nextPeasantLabel: "Next peasant",
    nextPeasantProgress: ({
      stored,
      needed,
    }: {
      stored: string;
      needed: string;
    }) => `${stored} / ${needed} grain`,
    nextPeasantEstimate: ({
      progress,
      wait,
    }: {
      progress: string;
      wait: string;
    }) => `${progress}  (~${wait})`,
  },
  village: {
    emptyVillage: "The village is empty. Press n to found a new one.",
    grudge: "(grudge)",
    moreAbove: ({ count }: { count: string }) => `↑ ${count} more`,
    moreBelow: ({ count }: { count: string }) => `↓ ${count} more`,
    noPeasantSelected: "Nobody is selected.",
    governorsHeading: "Governors",
    peasantsHeading: "Peasants",
    governorVillage: ({ village }: { village: number }) =>
      `village of ${village}`,
    governorReports: ({ rate, resource }: { rate: string; resource: string }) =>
      `reports ${rate} ${resource}/s`,
    governorIdle: "has no work",
    governorBringsIn: ({
      real,
      resource,
      gap,
    }: {
      real: string;
      resource: string;
      gap: string;
    }) => `brings in ${real} ${resource}/s, claims ${gap} more`,
    governorHonest: ({ real, resource }: { real: string; resource: string }) =>
      `brings in ${real} ${resource}/s, claims only what they bring in`,
    governorSeasonsLeft: ({ seasons }: { seasons: number }) =>
      `${seasons} ${plural(seasons, "season", "seasons")} left`,
    archiveTitle: "The Archive",
    archiveEmpty: "Nothing more to learn, for now.",
    costJoin: " · ",
    noDecreeInForce: ({ petition }: { petition: string }) =>
      `No ${petition} decree is in force.`,
    crownProgress: ({
      resource,
      delivered,
      amount,
    }: {
      resource: string;
      delivered: string;
      amount: string;
    }) => `${resource} ${delivered} / ${amount}`,
    crownDueIn: ({ wait }: { wait: string }) => `due in ${wait}`,
    crownQuiet: ({ wait }: { wait: string }) =>
      `The crown is quiet. Next demand in about ${wait}.`,
    crownTally: ({ met, missed }: { met: number; missed: number }) =>
      `Met ${met} \u00b7 missed ${missed}`,
    crownFavor: {
      cold: "The crown regards you coldly.",
      neutral: "The crown regards you evenly.",
      warm: "The crown regards you warmly.",
    },
  },
  court: {
    deskClear: "The desk is clear.",
    deskTitle: "The desk",
    nothingWaits: "Nothing waits on the desk.",
    noLongerOnDesk: "This matter is no longer on the desk.",
    decideTitle: "Decide",
    dueIn: ({ wait, label }: { wait: string; label: string }) =>
      `(due in ${wait}) ${label}`,
    free: "free",
    sulks: ({ sulker }: { sulker: string }) =>
      `(${sulker} will sulk for a season)`,
    brings: ({ count }: { count: number }) =>
      `(brings ${count} ${count === 1 ? "peasant" : "peasants"})`,
    defaultIfIgnored: "(the default if ignored)",
  },
  menus: {
    listHintsBack: "up/down select · enter choose · esc back",
    listHintsClose: "up/down select · enter choose · esc close",
    numberHints: "0-9 . type · backspace erase · enter accept · esc back",
    unavailable: ({ label }: { label: string }) => `${label} (unavailable)`,
    newVillageTitle: "Found a new village?",
    newVillageAbandons:
      "The current village will be abandoned and the save overwritten.",
    newVillageLosesPurchases:
      "Anything bought in the Archive and every saved decree is lost too.",
    newVillageKeepsBackup: "The previous save stays as the backup file.",
    keepVillage: "No, keep this village",
    foundVillage: "Yes, found a new village",
    namePromptTitle: "Name your village",
    namePromptHints: "type a name · enter found the village · esc cancel",
    cannotReadSave: ({ error, path }: { error: string; path: string }) =>
      `Steward cannot read its save: ${error}\nThe save at ${path} was left untouched. Fix or move it, then start again.`,
    couldNotSave: ({ error }: { error: string }) =>
      `Could not save the game: ${error}`,
  },
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
      governors: "Governors",
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
      peasantsEat: ({
        rate,
        idleRate,
        feeds,
      }: {
        rate: string;
        idleRate: string;
        feeds: string;
      }) =>
        `Every working peasant eats ${rate}, and an idle one only ${idleRate}, so over a year one farmer feeds about ${feeds} working peasants.`,
      seasonLasts: ({ duration }: { duration: string }) =>
        `A season lasts ${duration}.`,
      seasonLastsWithBarren: ({
        duration,
        seasons,
      }: {
        duration: string;
        seasons: string;
      }) =>
        `A season lasts ${duration}. ${seasons} grows nothing, so store grain before it.`,
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
      storeCap: ({ cap }: { cap: string }) =>
        `The granary holds ${cap} grain. Harvest past that is lost, so sell or feed the surplus; the Archive sells bigger stores.`,
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
        `Coin, grain, wood and ore buy entries from the Archive (press ${key}), including the Court, decrees, the Crown charter and each control you will come to need.`,
    },
    woodAndOre: {
      woodCut: ({ rate }: { rate: string }) =>
        `Foresters cut wood at ${rate} each.`,
      oreDug: ({ rate }: { rate: string }) => `Miners dig ore at ${rate} each.`,
      storeCap: ({ woodCap, oreCap }: { woodCap: string; oreCap: string }) =>
        `The woodshed holds ${woodCap} wood and the ore store ${oreCap} ore. Whatever is cut or dug past that is lost; the Archive sells bigger stores.`,
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
      laborSplit:
        "  Or give a split of your own, with a number for each job: farm 60 forest 30 mine 10. The numbers are relative, so farm 2 mine 1 works, and a job left out gets none.",
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
        `Reach ${population} peasants and the crown notices you: the Archive then offers a Crown charter, which you need to keep advancing.`,
      once: "Promotion happens once, and it is not taken back.",
    },
    crown: {
      firstDemand: ({
        shortestWait,
        longestWait,
      }: {
        shortestWait: string;
        longestWait: string;
      }) =>
        `Once you buy the Crown charter from the Archive, the crown makes one demand at a time, the first ${shortestWait} to ${longestWait} later: an amount of grain, wood, ore or coin, never the same resource twice running.`,
      deadline: ({
        shortestDeadline,
        longestDeadline,
        shortestGap,
        longestGap,
      }: {
        shortestDeadline: string;
        longestDeadline: string;
        shortestGap: string;
        longestGap: string;
      }) =>
        `Each demand has a deadline of ${shortestDeadline} to ${longestDeadline}, and a new one follows ${shortestGap} to ${longestGap} after each is settled.`,
      deliver: ({ key }: { key: string }) =>
        `Press ${key} to focus the Crown, then enter to deliver whatever the stores hold toward the demand. Partial deliveries add up.`,
      reward: ({ reward }: { reward: string }) =>
        `Paying in full before the deadline earns ${reward} of the amount back in coin.`,
      collection:
        "At the deadline the crown collects what is still owed from the stores. If they cannot cover it, the demand is missed.",
      missAndStep: ({ surcharge, step }: { surcharge: string; step: string }) =>
        `A miss adds ${surcharge} of the shortfall to the next demand, and every demand met raises later amounts by ${step} of the base.`,
      correspondence: ({ label, cost }: { label: string; cost: string }) =>
        `${label} (Archive, ${cost}) lets decrees read what is owed, as in "owed ore above 0".`,
      commandLine: "The command line also takes deliver.",
    },
    illusion: {
      teaches: ({ lot }: { lot: string }) =>
        `Conjuring and forging are bought from the Archive once you hold the Crown charter. Conjuring adds stock the Ledger counts and the stores do not hold. Only grain and coin can be conjured, ${lot} at a time.`,
      conjure: ({ key }: { key: string }) =>
        `Press ${key} to focus the Ledger, then enter to conjure a lot of the selected resource. The command line takes conjure <grain or coin> <amount>.`,
      outsiders:
        "Only outsiders accept it: the crown, merchants and the Archive. Peasants cannot eat it and decrees cannot sell it. A payment uses conjured stock first, then real stock.",
      fades: ({ fade }: { fade: string }) =>
        `It fades, by about ${fade} a season.`,
      debt: ({
        interest,
        forgeKey,
        forgeMissingKey,
      }: {
        interest: string;
        forgeKey: string;
        forgeMissingKey: string;
      }) =>
        `Whatever is passed off to an outsider becomes debt, and each season the debt grows by ${interest} of what was passed off, never more. Press ${forgeKey} in the Crown panel to forge a report: it marks what is still owed as delivered, in any resource, and the forged amount becomes debt. Press ${forgeMissingKey} to deliver what the stores hold first and forge only the rest. The command line takes forge and forge missing.`,
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
        `To repay, select a resource in the Ledger and press ${key}, or type back <resource>. Debt is repaid from real stock, at any time. If the stock falls short, it repays as much as it holds and the rest stays owed. The Ledger shows each resource's debt under its row and the command reports what it repaid.`,
      roughDebt: ({ step }: { step: string }) =>
        `The Ledger rounds debt up to the nearest ${step}, so a small debt never reads as none.`,
      exactDebt:
        "Exact books are owned: the Ledger shows debt to the decimal, and the time until announced auditors arrive.",
      precision: ({
        exactLabel,
        exactCost,
        reportsLabel,
        reportsCost,
      }: {
        exactLabel: string;
        exactCost: string;
        reportsLabel: string;
        reportsCost: string;
      }) =>
        `The Archive sells precision: ${exactLabel} (${exactCost}) shows exact debt and the time to an audit, and lets decrees read debt. ${reportsLabel} (${reportsCost}) strips governors' exaggeration from the Ledger's rates.`,
      auditors: ({
        debtShare,
        seasons,
        gap,
        warning,
        deadline,
      }: {
        debtShare: string;
        seasons: string;
        gap: string;
        warning: string;
        deadline: string;
      }) =>
        `Auditors are sent when debt reaches ${debtShare} of the ceiling, or when any debt is ${seasons} seasons old, but never within ${gap} seasons of the last audit. They arrive ${warning} after the warning and wait ${deadline} on the desk.`,
      outcomes: ({ cost, fee }: { cost: string; fee: string }) =>
        `The desk offers three outcomes: back the debt from real stock, a deeper illusion that costs real coin worth ${cost} of the debt and adds ${fee} of what was passed off to the debt, or let the deadline pass.`,
      deadlinePasses:
        "If the deadline passes, the auditors seize real stock toward the debt and the debt is cleared; they leave the grain the village needs for a season. If the stores cannot cover it, the crown counts a missed demand.",
    },
    governors: {
      what: ({
        cap,
        smallest,
        largest,
      }: {
        cap: string;
        smallest: string;
        largest: string;
      }) =>
        `Once you have bought governors from the Archive, which needs the Crown charter, you can take on governors, up to ${cap} at a time. A governor is a named character who runs a village of ${smallest} to ${largest} peasants at one job, and that village counts toward your population.`,
      candidates: ({
        key,
        cheapest,
        dearest,
      }: {
        key: string;
        cheapest: string;
        dearest: string;
      }) =>
        `Candidates arrive on the desk (press ${key}) only once governors are bought, and only while hiring every one waiting would stay within the cap. Each asks ${cheapest} to ${dearest} coin. Declining, or letting one leave, costs nothing.`,
      assigning: ({
        key,
        farmKey,
        forestKey,
        mineKey,
        idleKey,
      }: {
        key: string;
        farmKey: string;
        forestKey: string;
        mineKey: string;
        idleKey: string;
      }) =>
        `Governors are listed above the peasants in the Peasants panel (press ${key}). Select one and give them a job with ${farmKey}, ${forestKey}, ${mineKey} or ${idleKey}, as with a peasant. Labor decrees and famine never move them.`,
      traitsIntro: "Each governor has one or two traits:",
      trait: {
        diligent: ({ outputChange }: TraitFigures) =>
          `Their village brings in ${outputChange} more than its size suggests.`,
        skimmer: ({ outputChange, reportRise }: TraitFigures) =>
          `Their village brings in ${outputChange} less, and they report ${reportRise} more than that.`,
        braggart: ({ reportRise }: TraitFigures) =>
          `They report ${reportRise} more than their village brings in.`,
        hoarder: ({ outputChange }: TraitFigures) =>
          `Their village brings in ${outputChange} less. They keep the difference as coin and hand it over when they leave.`,
        "empire-builder": ({ limit, reportRise }: TraitFigures) =>
          `Their village gains a peasant each season, up to ${limit}, and they report ${reportRise} more than it brings in.`,
      } satisfies Record<Trait, (figures: TraitFigures) => string>,
      reports: {
        inflated:
          "A governor's report may exceed what their village really brings in. The Ledger's rates include the report, so they can outrun what lands in the stores.",
        hidden: ({ label, cost }: { label: string; cost: string }) =>
          `${label} (Archive, ${cost}) shows each governor's real output and the gap on their row, and removes the exaggeration from the Ledger's rates.`,
        shown:
          "True reports are owned, so each governor's row shows their real output and how far their report is off.",
      },
      terms: ({
        shortest,
        longest,
        death,
      }: {
        shortest: string;
        longest: string;
        death: string;
      }) =>
        `A governor serves ${shortest} to ${longest}, then retires, and each season carries a ${death} chance that they die. Either way their village leaves the population and a candidate may arrive to replace them.`,
      dismissal:
        "A failed audit dismisses one governor: the one whose reports exaggerate the most, or the newest hire if none exaggerates.",
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
      forgeMissing: "forge missing",
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
    nothingToBuyYet: "nothing in the Archive can be bought yet",
    alreadyOwn: ({ label }: { label: string }) => `you already own ${label}`,
    needsFirst: ({ label, missing }: { label: string; missing: string }) =>
      `${label} needs ${missing} first`,
    needsArchive: ({ verb }: { verb: string }) =>
      `${verb} needs the Archive, which opens once the granary has filled past its first harvest`,
    needsEntry: ({ verb, label }: { verb: string; label: string }) =>
      `${verb} needs "${label}" from the Archive`,
    needsConjuring: ({ verb }: { verb: string }) =>
      `${verb} needs conjuring from the Archive, once you hold the Crown charter`,
    needsForging: ({ verb }: { verb: string }) =>
      `${verb} needs forging from the Archive, once you hold the Crown charter`,
    needsDebt: "back needs a debt to repay",
    needsCrown: ({ verb }: { verb: string }) =>
      `${verb} needs the Crown charter from the Archive`,
    archiveEntryHelp: ({
      label,
      cost,
      description,
    }: {
      label: string;
      cost: string;
      description: string;
    }) => `${label}, ${cost}: ${description}`,
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
    }) => `${label}, ${cost}: ${description} (need ${shortfall})`,
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
      forgeMissing: "deliver what the stores hold, then forge the rest",
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
      auditors: "1 while auditors wait at the desk, otherwise 0",
      candidates: "governors waiting on the desk to be hired",
      coin: "coin in the treasury",
      debt: "coin value of the illusion passed off as real",
      demandTicks:
        "ticks until the open crown demand is collected, 0 when none is open",
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
  decrees: {
    none: "none",
    allOf: ({ conditions }: { conditions: string }) => `all of (${conditions})`,
    anyOf: ({ conditions }: { conditions: string }) => `any of (${conditions})`,
    harvestPolicies: {
      feed: "the surplus grows the village",
      sell: "the surplus is sold for coin",
      stockpile: "the surplus is stored",
    },
    storePolicies: {
      sell: ({ resource }: { resource: string }) =>
        `the ${resource} is sold for coin`,
      stockpile: ({ resource }: { resource: string }) =>
        `the ${resource} is stored`,
    },
    everyone: {
      farm: "everyone farms",
      forest: "everyone works the forest",
      mine: "everyone mines",
    },
  },
} as const;
