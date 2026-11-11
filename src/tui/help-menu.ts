import { copy } from "../core/copy";
import { policiesFor } from "../core/decree";
import { Job, type Resource, SEASONS } from "../core/realm";
import type { Tuning } from "../core/tuning";
import {
  type ArchiveEntry,
  CHAINING_UNLOCK,
  COMPOUND_UNLOCK,
  CROWN_CORRESPONDENCE,
  SAVED_DECREES_UNLOCK,
} from "../core/unlocks";
import { describePolicy, percent, plain } from "./decree-format";
import { capitalize } from "./format";
import {
  FOCUS_IDS,
  type KeyPress,
  keyFor,
  keyHints,
  panelHintKey,
  panelKeyHints,
  peasantKeyFor,
  plainKeyName,
} from "./keys";
import type { MenuContext, MenuRender } from "./menu";
import type { PanelSize } from "./village-panels";
import { wrapLine } from "./wrap";

function perSecond(perTick: number, tuning: Tuning): string {
  return `${plain((perTick * 1000) / tuning.stepMs)}/s`;
}

function seconds(ticks: number, tuning: Tuning): string {
  return `${plain((ticks * tuning.stepMs) / 1000)} s`;
}

function rulingsTouching(
  tuning: Tuning,
  resource: Resource,
  sign: "costs" | "pays",
): boolean {
  return Object.values(tuning.desk.kinds).some(({ templates }) =>
    templates.some((template) =>
      template.options.some((option) => {
        const amount = option.resources?.[resource] ?? 0;
        return sign === "costs" ? amount < 0 : amount > 0;
      }),
    ),
  );
}

function keysLines(context: MenuContext): string[] {
  const hints = keyHints(context.view.unlocks);
  const panelHints = FOCUS_IDS.map((id) => ({
    keys: copy.help.keys.panelRowLabel({ panel: capitalize(id) }),
    label: panelKeyHints(id)
      .map((hint) => `${hint.keys} ${hint.label}`)
      .join(", "),
  }));
  const width = Math.max(
    ...[...hints, ...panelHints].map((hint) => hint.keys.length),
  );
  const row = (hint: { keys: string; label: string }) =>
    `${hint.keys.padEnd(width)}  ${hint.label}`;
  return [
    ...hints.map(row),
    row({ keys: "←/→", label: copy.help.keys.arrowsLabel }),
    "",
    copy.help.keys.focusPanels,
    ...panelHints.map(row),
    "",
    copy.help.keys.inMenus,
    copy.help.keys.assignJobs({
      farmKey: peasantKeyFor(Job.FARM),
      forestKey: peasantKeyFor(Job.FOREST),
      mineKey: peasantKeyFor(Job.MINE),
      idleKey: peasantKeyFor(Job.IDLE),
    }),
  ];
}

function grainLines(tuning: Tuning): string[] {
  const { economy } = tuning;
  const yields = SEASONS.map((season) =>
    copy.help.grain.seasonYield({
      season,
      rate: perSecond(
        economy.grainPerFarmer * economy.seasonYield[season],
        tuning,
      ),
    }),
  ).join(", ");
  const meanYield =
    SEASONS.reduce((sum, season) => sum + economy.seasonYield[season], 0) /
    SEASONS.length;
  const feeds = plain(
    (economy.grainPerFarmer * meanYield) / economy.grainPerPerson,
  );
  const barren = SEASONS.filter((season) => economy.seasonYield[season] === 0);
  const seasonLength = seconds(economy.ticksPerSeason, tuning);
  return [
    copy.help.grain.farmersGrow({ yields }),
    copy.help.grain.peasantsEat({
      rate: perSecond(economy.grainPerPerson, tuning),
      feeds,
    }),
    barren.length === 0
      ? copy.help.grain.seasonLasts({ duration: seasonLength })
      : copy.help.grain.seasonLastsWithBarren({
          duration: seasonLength,
          seasons: capitalize(barren.join(" and ")),
        }),
    copy.help.grain.noHarvestCost({
      grain: plain(economy.grainPerPerson * economy.ticksPerSeason),
    }),
    copy.help.grain.seasonsRuleAdvice,
    copy.help.grain.famine({ duration: seasonLength }),
    copy.help.grain.famineEnds,
    "",
    copy.help.grain.newPeasants({ grain: plain(economy.grainPerPeasant) }),
    copy.help.grain.populationCap({
      maxPopulation: plain(economy.maxPopulation),
    }),
    copy.help.grain.feedingThroughDecree,
  ];
}

function coinLines(context: MenuContext): string[] {
  const { tuning } = context;
  const lines = [
    copy.help.coin.steadySource({
      grainPrice: plain(tuning.economy.grainPrice),
      woodPrice: plain(tuning.economy.woodPrice),
      orePrice: plain(tuning.economy.orePrice),
    }),
    copy.help.coin.sellingThroughDecree,
  ];
  if (rulingsTouching(tuning, "coin", "pays")) {
    lines.push(copy.help.coin.merchantsPay);
  }
  if (rulingsTouching(tuning, "coin", "costs")) {
    lines.push("", copy.help.coin.spentOn);
  }
  if (context.view.archive.open) {
    lines.push("", copy.help.coin.archiveBuys({ key: keyFor("archive") }));
  }
  return lines;
}

function woodAndOreLines(tuning: Tuning): string[] {
  const { economy } = tuning;
  const { woodAndOre } = copy.help;
  return [
    woodAndOre.woodCut({ rate: perSecond(economy.woodPerWorker, tuning) }),
    woodAndOre.oreDug({ rate: perSecond(economy.orePerWorker, tuning) }),
    "",
    rulingsTouching(tuning, "wood", "costs")
      ? woodAndOre.woodPays
      : woodAndOre.woodNoUse,
    rulingsTouching(tuning, "ore", "costs")
      ? woodAndOre.orePays
      : woodAndOre.oreNoUse,
    woodAndOre.prices({
      woodPrice: plain(economy.woodPrice),
      orePrice: plain(economy.orePrice),
    }),
  ];
}

function decreeLines(context: MenuContext): string[] {
  const owns = (id: string) => context.view.unlocks.includes(id);
  const owned: string[] = [];
  if (owns(COMPOUND_UNLOCK)) owned.push(copy.help.decrees.compound);
  if (owns(CHAINING_UNLOCK)) owned.push(copy.help.decrees.chaining);
  if (owns(SAVED_DECREES_UNLOCK)) owned.push(copy.help.decrees.saved);
  return [
    copy.help.decrees.petitions,
    copy.help.decrees.ruleOrder,
    copy.help.decrees.grainSeasonsMeaning,
    "",
    copy.help.decrees.howToIssue({ key: keyFor("decrees") }),
    copy.help.decrees.harvestExample,
    copy.help.decrees.exampleAboveThree,
    copy.help.decrees.exampleBetween,
    copy.help.decrees.exampleBothMatch,
    copy.help.decrees.exampleSwapped,
    "",
    copy.help.decrees.withdraw({
      key: panelHintKey("decrees", copy.keys.panelActions.repeal),
    }),
    ...(owned.length === 0 ? [] : ["", ...owned]),
  ];
}

function harvestAndLaborLines(tuning: Tuning): string[] {
  const { economy } = tuning;
  const { harvestAndLabor } = copy.help;
  const allocations = policiesFor("labor", tuning).map((name) =>
    describePolicy("labor", name, tuning),
  );
  return [
    harvestAndLabor.eachTick,
    harvestAndLabor.exception,
    harvestAndLabor.exceptionActsOn,
    harvestAndLabor.otherwiseActsOn,
    harvestAndLabor.noDecree,
    "",
    harvestAndLabor.laborMoves({ moves: economy.laborMovesPerTick }),
    ...allocations.map((line) => `  ${line}`),
    harvestAndLabor.laborChangesOnly,
    "",
    harvestAndLabor.laborExample,
  ];
}

function deskLines(tuning: Tuning): string[] {
  const { desk } = tuning;
  const { minTicks, maxTicks } = desk.arrival;
  return [
    copy.help.desk.arrivals({
      shortestWait: seconds(minTicks, tuning),
      longestWait: seconds(maxTicks, tuning),
      slots: plain(desk.slots),
    }),
    copy.help.desk.overflow,
    "",
    copy.help.desk.rulingCost,
    copy.help.desk.sulking({ duration: seconds(desk.grudgeTicks, tuning) }),
    copy.help.desk.merchantsAndTravellers,
    copy.help.desk.disputeDropped,
    "",
    copy.help.desk.openDesk({ key: keyFor("court") }),
  ];
}

function promotionLines(tuning: Tuning): string[] {
  return [
    copy.help.promotion.reach({
      population: plain(tuning.village.promotionPopulation),
    }),
    copy.help.promotion.once,
  ];
}

function crownLines(tuning: Tuning): string[] {
  const { crown } = tuning;
  const { minTicks, maxTicks } = crown.gap;
  // The tuning schema requires every decree gate, crown correspondence among them, to be an Archive entry.
  const entry = tuning.archive.entries.find(
    (candidate) => candidate.id === CROWN_CORRESPONDENCE,
  ) as ArchiveEntry;
  return [
    copy.help.crown.firstDemand({
      wait: seconds(crown.firstDemandTicks, tuning),
    }),
    copy.help.crown.deadline({
      deadline: seconds(crown.deadlineTicks, tuning),
      shortestGap: seconds(minTicks, tuning),
      longestGap: seconds(maxTicks, tuning),
    }),
    "",
    copy.help.crown.deliver({ key: keyFor("crown") }),
    copy.help.crown.reward({ reward: percent(crown.reward) }),
    copy.help.crown.collection,
    copy.help.crown.missAndStep({
      surcharge: percent(crown.surcharge),
      step: percent(crown.step),
    }),
    "",
    copy.help.crown.correspondence({
      label: entry.label,
      cost: plain(entry.cost),
    }),
    copy.help.crown.commandLine,
  ];
}

function illusionLines(tuning: Tuning): string[] {
  const { illusion, economy } = tuning;
  const { audit, books } = illusion;
  const season = economy.ticksPerSeason;
  const perSeason = (rate: number, sign: 1 | -1) =>
    `${Math.round(Math.abs((1 + sign * rate) ** season - 1) * 100)}%`;
  return [
    copy.help.illusion.teaches({ lot: plain(illusion.lot) }),
    "",
    copy.help.illusion.conjure({ key: keyFor("ledger") }),
    copy.help.illusion.outsiders,
    copy.help.illusion.fades({ fade: perSeason(illusion.fadePerTick, -1) }),
    "",
    copy.help.illusion.debt({
      growth: perSeason(illusion.interestPerTick, 1),
      forgeKey: panelHintKey("crown", copy.keys.panelActions.forge),
    }),
    copy.help.illusion.ceiling({
      ceiling: plain(illusion.ceilingPerPeasant),
      grainAndWoodPrice: plain(economy.grainPrice),
      oreAndCoinPrice: plain(economy.orePrice),
    }),
    copy.help.illusion.books({
      strained: percent(books.strained),
      rotten: percent(books.rotten),
    }),
    "",
    copy.help.illusion.repay({
      key: panelHintKey("ledger", copy.keys.panelActions.repay),
    }),
    "",
    copy.help.illusion.auditors({
      debtShare: percent(audit.debtShare),
      seasons: plain(audit.ageTicks / season),
      warning: seconds(audit.warningTicks, tuning),
      deadline: seconds(audit.deadlineTicks, tuning),
    }),
    copy.help.illusion.outcomes({
      cost: percent(audit.deepenCost),
      growth: plain(audit.deepenGrowth),
    }),
    copy.help.illusion.deadlinePasses,
  ];
}

export type HelpTopicId = keyof typeof copy.help.topics;

const TOPICS: readonly {
  id: HelpTopicId;
  lines: (context: MenuContext) => string[];
}[] = [
  { id: "keys", lines: keysLines },
  { id: "grain", lines: (c) => grainLines(c.tuning) },
  { id: "coin", lines: coinLines },
  { id: "woodAndOre", lines: (c) => woodAndOreLines(c.tuning) },
  { id: "decrees", lines: decreeLines },
  { id: "harvestAndLabor", lines: (c) => harvestAndLaborLines(c.tuning) },
  { id: "desk", lines: (c) => deskLines(c.tuning) },
  { id: "promotion", lines: (c) => promotionLines(c.tuning) },
  { id: "crown", lines: (c) => crownLines(c.tuning) },
  { id: "illusion", lines: (c) => illusionLines(c.tuning) },
];

export type HelpSection = {
  id: HelpTopicId;
  heading: string;
  lines: string[];
};

export function helpSections(context: MenuContext): HelpSection[] {
  return TOPICS.map((topic) => ({
    id: topic.id,
    heading: copy.help.topics[topic.id],
    lines: topic.lines(context),
  }));
}

/** One scrolling page holding every topic, wrapped to the terminal so a scroll step is always one screen line. */
export class HelpPage {
  private offset = 0;

  private pageLines(context: MenuContext, width: number): string[] {
    return helpSections(context).flatMap((section, index) => [
      ...(index === 0 ? [] : [""]),
      section.heading.toUpperCase(),
      ...section.lines.flatMap((line) => wrapLine(line, width, 2)),
    ]);
  }

  private scrollBy(lineCount: number, viewport: PanelSize, delta: number) {
    const last = Math.max(0, lineCount - viewport.height);
    this.offset = Math.max(0, Math.min(last, this.offset + delta));
  }

  /** Returns false once the page asks to close. */
  key(key: KeyPress, context: MenuContext, viewport: PanelSize): boolean {
    const name = plainKeyName(key);
    if (name === "escape" || name === "?") return false;
    const lineCount = this.pageLines(context, viewport.width).length;
    if (name === "j" || name === "down") this.scrollBy(lineCount, viewport, 1);
    else if (name === "k" || name === "up") {
      this.scrollBy(lineCount, viewport, -1);
    } else if (name === "space" || (name !== null && key.sequence === " ")) {
      this.scrollBy(lineCount, viewport, Math.max(1, viewport.height - 1));
    }
    return true;
  }

  render(context: MenuContext, viewport: PanelSize): MenuRender {
    const all = this.pageLines(context, viewport.width);
    this.scrollBy(all.length, viewport, 0);
    const end = Math.min(all.length, this.offset + viewport.height);
    return {
      title: copy.help.title,
      lines: all.slice(this.offset, end),
      hints: `${copy.help.scrollHints} \u00b7 ${end}/${all.length}`,
    };
  }
}
