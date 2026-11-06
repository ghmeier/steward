import { policiesFor } from "../core/decree";
import { type Resource, SEASONS } from "../core/realm";
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
  keyHints,
  panelKeyHints,
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
    keys: `${capitalize(id)}:`,
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
    row({ keys: "\u2190/\u2192", label: "panels" }),
    "",
    "Press a panel's letter to focus it; esc leaves it. While a panel is focused its keys win:",
    ...panelHints.map(row),
    "",
    "In any menu: up/down to move, enter to choose, esc to go back.",
    "f, w, m and i put the selected peasant on the farm, in the forest, in the mine or idle, once Peasants is focused.",
  ];
}

function grainLines(tuning: Tuning): string[] {
  const { economy } = tuning;
  const yields = SEASONS.map(
    (season) =>
      `${season} ${perSecond(economy.grainPerFarmer * economy.seasonYield[season], tuning)}`,
  ).join(", ");
  const meanYield =
    SEASONS.reduce((sum, season) => sum + economy.seasonYield[season], 0) /
    SEASONS.length;
  const feeds = plain(
    (economy.grainPerFarmer * meanYield) / economy.grainPerPerson,
  );
  const barren = SEASONS.filter((season) => economy.seasonYield[season] === 0);
  const barrenLine =
    barren.length === 0
      ? ""
      : ` ${capitalize(barren.join(" and "))} grows nothing, so store grain before it.`;
  return [
    `Farmers grow grain, per farmer: ${yields}.`,
    `Every peasant eats ${perSecond(economy.grainPerPerson, tuning)}, so over a year one farmer feeds about ${feeds} peasants.`,
    `A season lasts ${seconds(economy.ticksPerSeason, tuning)}.${barrenLine}`,
    `A season with no harvest costs each peasant ${plain(economy.grainPerPerson * economy.ticksPerSeason)} grain, so the stores must grow with the village.`,
    "That is why rules on grain seasons are safer than rules on a fixed amount of grain.",
    `Once the stores are empty, a famine takes at most half the village, spread over a season (${seconds(economy.ticksPerSeason, tuning)}), idle peasants first.`,
    "The famine ends as soon as everyone eats again.",
    "",
    `New peasants come only from feeding: every ${plain(economy.grainPerPeasant)} grain fed makes one,`,
    `up to ${plain(economy.maxPopulation)} peasants. Only grain can be fed.`,
    "Feeding happens through a harvest decree (see Harvest and labor).",
  ];
}

function coinLines(context: MenuContext): string[] {
  const { tuning } = context;
  const lines = [
    `The only steady source of coin is selling: grain at ${plain(tuning.economy.grainPrice)} coin each, wood at ${plain(tuning.economy.woodPrice)} and ore at ${plain(tuning.economy.orePrice)}.`,
    "Selling happens through a harvest, wood or ore decree (see Harvest and labor).",
  ];
  if (rulingsTouching(tuning, "coin", "pays")) {
    lines.push("Merchants and some rulings pay coin as well.");
  }
  if (rulingsTouching(tuning, "coin", "costs")) {
    lines.push("", "Coin is spent on rulings and on merchants' wares.");
  }
  if (context.view.archive.open) {
    lines.push("", "Coin also buys entries from the Archive (press a).");
  }
  return lines;
}

function resourceUse(tuning: Tuning, resource: Resource, name: string) {
  return rulingsTouching(tuning, resource, "costs")
    ? `${name} pays for some rulings and merchants' wares.`
    : `${name} has no use yet.`;
}

function woodAndOreLines(tuning: Tuning): string[] {
  const { economy } = tuning;
  return [
    `Foresters cut wood at ${perSecond(economy.woodPerWorker, tuning)} each.`,
    `Miners dig ore at ${perSecond(economy.orePerWorker, tuning)} each.`,
    "",
    resourceUse(tuning, "wood", "Wood"),
    resourceUse(tuning, "ore", "Ore"),
    `Wood sells for ${plain(economy.woodPrice)} coin and ore for ${plain(economy.orePrice)}, through a wood or ore decree (see Harvest and labor).`,
  ];
}

function decreeLines(context: MenuContext): string[] {
  const owns = (id: string) => context.view.unlocks.includes(id);
  const owned: string[] = [];
  if (owns(COMPOUND_UNLOCK)) {
    owned.push(
      "Join conditions with and, or or (one kind per rule), and put not before one to flip it.",
    );
  }
  if (owns(CHAINING_UNLOCK)) {
    owned.push(
      'A condition can read another decree, as in "harvest chose sell".',
    );
  }
  if (owns(SAVED_DECREES_UNLOCK)) {
    owned.push(
      "Keep a decree with: save <name> decree ... Then enact <name> brings it back, and forget <name> deletes it.",
    );
  }
  return [
    "A decree answers one of four petitions, harvest (grain), wood, ore or labor, and each petition holds one decree.",
    "Rules are checked in order and the first match wins. Otherwise applies when none match.",
    '"Grain seasons" is how many seasons the stores would feed everyone.',
    "",
    "Press d to focus Decrees, then enter on a petition and type the decree: tab completes a word, enter issues it. A new decree replaces the one for its petition.",
    "Example, a harvest decree: decree harvest sell when grain seasons above 3, feed when grain seasons above 2 otherwise stockpile",
    "  While the stores are above 3 seasons, each tick's new surplus is sold.",
    "  Between 2 and 3 it is fed, to grow the village. Below 2 it is kept.",
    "  At 3.5 seasons both rules match, and sell wins by coming first.",
    "  Swap them and feed catches everything above 2, so nothing is ever sold.",
    "",
    "To withdraw a decree, focus Decrees, select its petition and press x.",
    ...(owned.length === 0 ? [] : ["", ...owned]),
  ];
}

function harvestAndLaborLines(tuning: Tuning): string[] {
  const { economy } = tuning;
  const moves = economy.laborMovesPerTick;
  const allocations = policiesFor("labor", tuning).map((name) =>
    describePolicy("labor", name, tuning),
  );
  return [
    "Harvest, wood and ore: each tick, a decree feeds (grain only), sells or stockpiles that resource.",
    '  Exception: a rule like "sell when wood above 50" (the decree\'s own resource, above a number)',
    "  acts on everything above that number, so it brings the stock back down to 50 at once.",
    "  Any other rule, and otherwise, acts on only that tick's new production (for grain, the surplus beyond what everyone eats).",
    "  With no decree for a resource, it is stockpiled.",
    "",
    `Labor: each tick, ${plain(moves)} ${moves === 1 ? "peasant moves" : "peasants move"} toward a split of farm, forest and mine:`,
    ...allocations.map((line) => `  ${line}`),
    "  A labor decree moves peasants when its policy changes, and your hand assignments stay until then.",
    "",
    "Example, a labor decree: decree labor mine when it is winter otherwise farm",
  ];
}

function deskLines(tuning: Tuning): string[] {
  const { desk } = tuning;
  const { minTicks, maxTicks } = desk.arrival;
  const range = `${seconds(minTicks, tuning)} to ${seconds(maxTicks, tuning)}`;
  return [
    `Something arrives on the desk every ${range}, onto a desk of ${plain(desk.slots)} slots. It is a dispute between two peasants, a merchant with an offer, or a traveller asking to settle.`,
    "When the desk overflows, the oldest entry takes its default answer, and the merchant or traveller moves on.",
    "",
    "A ruling can cost stores, or make one party sulk.",
    `A sulking peasant produces nothing and refuses a job, for ${seconds(desk.grudgeTicks, tuning)}.`,
    "A merchant trades at his own price, so check it against the market. A traveller who settles costs grain and adds one peasant, if the village has room.",
    "A dispute is dropped if one of its parties dies. Merchants and travellers wait their turn.",
    "",
    "Press c to open the desk and answer what is waiting.",
  ];
}

function promotionLines(tuning: Tuning): string[] {
  return [
    `Reach ${plain(tuning.village.promotionPopulation)} peasants and the crown notices you.`,
    "Promotion happens once, and it is not taken back.",
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
    `After promotion the crown makes one demand at a time, the first ${seconds(crown.firstDemandTicks, tuning)} later: an amount of grain, wood, ore or coin, never the same resource twice running.`,
    `Each demand has a deadline of ${seconds(crown.deadlineTicks, tuning)}, and a new one follows ${seconds(minTicks, tuning)} to ${seconds(maxTicks, tuning)} after each is settled.`,
    "",
    "Press r to focus the Crown, then enter to deliver whatever the stores hold toward the demand. Partial deliveries add up.",
    `Paying in full before the deadline earns ${percent(crown.reward)} of the amount back in coin.`,
    "At the deadline the crown collects what is still owed from the stores. If they cannot cover it, the demand is missed.",
    `A miss adds ${percent(crown.surcharge)} of the shortfall to the next demand, and every demand met raises later amounts by ${percent(crown.step)} of the base.`,
    "",
    `${entry.label} (Archive, ${plain(entry.cost)} coin) lets decrees read what is owed, as in "owed ore above 0".`,
    "The command line also takes deliver.",
  ];
}

const TOPICS: readonly {
  label: string;
  lines: (context: MenuContext) => string[];
}[] = [
  { label: "Keys", lines: keysLines },
  { label: "Grain and growth", lines: (c) => grainLines(c.tuning) },
  { label: "Coin", lines: coinLines },
  { label: "Wood and ore", lines: (c) => woodAndOreLines(c.tuning) },
  { label: "Decrees", lines: decreeLines },
  { label: "Harvest and labor", lines: (c) => harvestAndLaborLines(c.tuning) },
  { label: "The desk", lines: (c) => deskLines(c.tuning) },
  { label: "Promotion", lines: (c) => promotionLines(c.tuning) },
  { label: "Crown", lines: (c) => crownLines(c.tuning) },
];

export type HelpSection = { heading: string; lines: string[] };

export function helpSections(context: MenuContext): HelpSection[] {
  return TOPICS.map((topic) => ({
    heading: topic.label,
    lines: topic.lines(context),
  }));
}

const HELP_HINTS = "j/k scroll \u00b7 space page \u00b7 esc close";

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
      title: "Help",
      lines: all.slice(this.offset, end),
      hints: `${HELP_HINTS} \u00b7 ${end}/${all.length}`,
    };
  }
}
