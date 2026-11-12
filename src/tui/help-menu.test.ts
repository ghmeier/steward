import { describe, expect, test } from "bun:test";
import { effectOf, topicLines, tuning } from "../../test/helpers";
import { copy, type TraitFigures } from "../core/copy";
import { policiesFor } from "../core/decree";
import { Job, type Trait } from "../core/realm";
import type { Tuning } from "../core/tuning";
import {
  ARCHIVE_PANEL,
  type ArchiveEntry,
  CHAINING_UNLOCK,
  COMPOUND_UNLOCK,
  CONJURING,
  costLines,
  EXACT_DEBT,
  PALETTE_UNLOCK,
  SAVED_DECREES_UNLOCK,
  TRUE_REPORTS,
} from "../core/unlocks";
import { describePolicy, percent } from "./decree-format";
import { capitalize, formatCost, plain } from "./format";
import type { HelpTopicId } from "./help-menu";
import { peasantKeyFor } from "./keys";
import { keymap } from "./village-panels";

const economy = (changes: Partial<Tuning["economy"]>): Tuning => ({
  ...tuning,
  economy: { ...tuning.economy, ...changes },
});
const village = (changes: Partial<Tuning["village"]>): Tuning => ({
  ...tuning,
  village: { ...tuning.village, ...changes },
});
const illusion = (changes: Partial<Tuning["illusion"]>): Tuning => ({
  ...tuning,
  illusion: { ...tuning.illusion, ...changes },
});
const governors = (changes: Partial<Tuning["governors"]>): Tuning => ({
  ...tuning,
  governors: { ...tuning.governors, ...changes },
});
const desk = (changes: Partial<Tuning["desk"]>): Tuning => ({
  ...tuning,
  desk: { ...tuning.desk, ...changes },
});

function rulingsWith(resources: Record<string, number>): Tuning {
  const free = ({
    templates,
  }: Tuning["desk"]["kinds"]["merchant" | "traveller" | "petition" | "omen"]) =>
    templates.map((template) => ({
      ...template,
      options: template.options.map(({ id, label }) => ({ id, label })),
    }));
  const { kinds } = tuning.desk;
  const [first, ...others] = free(kinds.dispute);
  const [head, ...rest] = first?.options ?? [];
  if (first === undefined || head === undefined) {
    throw new Error("no dispute option");
  }
  const options = [{ ...head, resources }, ...rest];
  return desk({
    kinds: {
      dispute: {
        ...kinds.dispute,
        templates: [{ ...first, options }, ...others],
      },
      merchant: { ...kinds.merchant, templates: free(kinds.merchant) },
      traveller: { ...kinds.traveller, templates: free(kinds.traveller) },
      petition: { ...kinds.petition, templates: free(kinds.petition) },
      omen: { ...kinds.omen, templates: free(kinds.omen) },
      candidate: kinds.candidate,
      audit: kinds.audit,
    },
  });
}

const laborChanged = economy({
  laborAllocations: {
    ...tuning.economy.laborAllocations,
    lumber: { farm: 0.1, forest: 0.8, mine: 0.1 },
  },
});
const barren = (autumn: number) =>
  economy({
    ticksPerSeason: 1200,
    seasonYield: { spring: 1, summer: 1, autumn, winter: 1 },
  });
const fertile = { spring: 1, summer: 1, autumn: 1, winter: 1 };

type Row = {
  name: string;
  topic: HelpTopicId;
  using?: Tuning;
  unlocks?: string[];
  has?: string[];
  lacks?: string[];
};

const { help } = copy;
const archiveEntry = (id: string) =>
  tuning.archive.entries.find((entry) => entry.id === id) as ArchiveEntry;
const costText = (entry: ArchiveEntry) => formatCost(costLines(entry));
const precisionSale = help.illusion.precision({
  exactLabel: archiveEntry(EXACT_DEBT).label,
  exactCost: costText(archiveEntry(EXACT_DEBT)),
  reportsLabel: archiveEntry(TRUE_REPORTS).label,
  reportsCost: costText(archiveEntry(TRUE_REPORTS)),
});
const traitLine = (trait: Trait, figures: TraitFigures) =>
  `  ${capitalize(copy.governors.traitWords[trait])}: ${help.governors.trait[trait](figures)}`;
const stepSeconds = (ticks: number) => `${ticks / 10} s`;

// biome-ignore format: one row per line keeps the table scannable
const rows: Row[] = [
	{ name: "coin prices", topic: "coin", using: economy({ grainPrice: 0.25, woodPrice: 0.75, orePrice: 3 }), has: [help.coin.steadySource({ grainPrice: "0.25", woodPrice: "0.75", orePrice: "3" })] },
	{ name: "feeding cost, population cap and season length", topic: "grain", using: economy({ grainPerPeasant: 45, maxPopulation: 77, ticksPerSeason: 1200, seasonYield: fertile }), has: [help.grain.newPeasants({ grain: "45" }), help.grain.populationCap({ maxPopulation: "77" }), help.grain.seasonLasts({ duration: stepSeconds(1200) })] },
	{ name: "year-round average feeding", topic: "grain", using: economy({ grainPerFarmer: 0.03, grainPerPerson: 0.01, seasonYield: { spring: 0.5, summer: 1, autumn: 0.5, winter: 0 } }), has: [help.grain.peasantsEat({ rate: "0.1/s", idleRate: "0.04/s", feeds: "1.5" })] },
	{ name: "season of eating cost and famine length", topic: "grain", using: economy({ grainPerPerson: 0.02, ticksPerSeason: 500 }), has: [help.grain.noHarvestCost({ grain: "10" }), help.grain.famine({ duration: stepSeconds(500) })] },
	{ name: "a barren season is named", topic: "grain", using: barren(0), has: [help.grain.seasonLastsWithBarren({ duration: stepSeconds(1200), seasons: "Autumn" })] },
	{ name: "no barren season, no warning", topic: "grain", using: barren(1), has: [help.grain.seasonLasts({ duration: stepSeconds(1200) })] },
	{ name: "one labor move per tick", topic: "harvestAndLabor", using: economy({ laborMovesPerTick: 1 }), has: [help.harvestAndLabor.laborMoves({ moves: 1 })] },
	{ name: "several labor moves per tick", topic: "harvestAndLabor", using: economy({ laborMovesPerTick: 3 }), has: [help.harvestAndLabor.laborMoves({ moves: 3 })] },
	{ name: "labor allocations", topic: "harvestAndLabor", using: laborChanged, has: policiesFor("labor", laborChanged).map((name) => `  ${describePolicy("labor", name, laborChanged)}`) },
	{ name: "wood rate converted with the step length", topic: "woodAndOre", using: { ...economy({ woodPerWorker: 0.03 }), stepMs: 250 }, has: [help.woodAndOre.woodCut({ rate: "0.12/s" })] },
	{ name: "desk arrival window, slots and grudge", topic: "desk", using: desk({ slots: 5, grudgeTicks: 300, arrival: { ...tuning.desk.arrival, minTicks: 100, maxTicks: 200 } }), has: [help.desk.arrivals({ shortestWait: stepSeconds(100), longestWait: stepSeconds(200), slots: "5" }), help.desk.sulking({ duration: stepSeconds(300) })] },
	{ name: "promotion population", topic: "promotion", using: village({ promotionPopulation: 33 }), has: [help.promotion.reach({ population: "33" })] },
	{ name: "wood rulings", topic: "woodAndOre", using: rulingsWith({ wood: -2 }), has: [help.woodAndOre.woodPays], lacks: [help.woodAndOre.woodNoUse] },
	{ name: "no wood rulings", topic: "woodAndOre", using: rulingsWith({ coin: -2 }), has: [help.woodAndOre.woodNoUse, help.woodAndOre.oreNoUse] },
	{ name: "ore rulings", topic: "woodAndOre", using: rulingsWith({ ore: -1 }), has: [help.woodAndOre.orePays], lacks: [help.woodAndOre.oreNoUse] },
	{ name: "coin rulings", topic: "coin", using: rulingsWith({ coin: -2 }), has: [help.coin.spentOn], lacks: [help.coin.merchantsPay] },
	{ name: "coin fines", topic: "coin", using: rulingsWith({ coin: 2 }), has: [help.coin.merchantsPay], lacks: [help.coin.spentOn] },
	{ name: "the Archive once open", topic: "coin", unlocks: [ARCHIVE_PANEL], has: [help.coin.archiveBuys({ key: keymap.keyFor("archive") })] },
	{ name: "no Archive before it opens", topic: "coin", lacks: [help.coin.archiveBuys({ key: keymap.keyFor("archive") })] },
	{ name: "rough debt and the Archive's precision entries before they are bought", topic: "illusion", has: [help.illusion.roughDebt({ step: "10" }), precisionSale], lacks: [help.illusion.exactDebt] },
	{ name: "exact books once owned, with true reports still on sale", topic: "illusion", unlocks: [EXACT_DEBT], has: [help.illusion.exactDebt], lacks: [help.illusion.roughDebt({ step: "10" })] },
	{ name: "no precision sale once both entries are owned", topic: "illusion", unlocks: [EXACT_DEBT, TRUE_REPORTS], lacks: [precisionSale] },
	{ name: "decrees before any unlock", topic: "decrees", lacks: [help.decrees.compound, help.decrees.chaining, help.decrees.saved] },
	{ name: "compound conditions once owned", topic: "decrees", unlocks: [COMPOUND_UNLOCK], has: [help.decrees.compound] },
	{ name: "chaining once owned", topic: "decrees", unlocks: [CHAINING_UNLOCK], has: [help.decrees.chaining] },
	{ name: "saved decrees once owned", topic: "decrees", unlocks: [SAVED_DECREES_UNLOCK], has: [help.decrees.saved] },
	{ name: "the lot, the ceiling and the fade read from tuning", topic: "illusion", using: illusion({ lot: 40, ceilingPerPeasant: 12, fadePerTick: 0.00115 }), has: [help.illusion.teaches({ lot: "40" }), help.illusion.ceiling({ ceiling: "12", grainAndWoodPrice: plain(tuning.economy.grainPrice), oreAndCoinPrice: plain(tuning.economy.orePrice) }), help.illusion.fades({ fade: "50%" })] },
	{ name: "the audit timings and the deeper illusion read from tuning", topic: "illusion", using: illusion({ audit: { ...tuning.illusion.audit, debtShare: 0.4, ageTicks: 1200, warningTicks: 300, deadlineTicks: 600, deepenCost: 0.25, deepenFee: 0.2, minGapTicks: 600 } }), has: [help.illusion.auditors({ debtShare: "40%", seasons: "2", gap: "1", warning: "30 s", deadline: "60 s" }), help.illusion.outcomes({ cost: "25%", fee: "20%" })] },
	{ name: "the cap, village sizes and candidate prices read from tuning", topic: "governors", using: governors({ cap: 6, village: { min: 4, max: 12 }, price: { min: 30, max: 90 } }), has: [help.governors.what({ cap: "6", smallest: "4", largest: "12" }), help.governors.candidates({ key: keymap.keyFor("court"), cheapest: "30", dearest: "90" })] },
	{ name: "each trait's factors and the empire-builder limit read from tuning", topic: "governors", using: governors({ empireBuilderLimit: 20, traits: { ...tuning.governors.traits, diligent: { output: 1.3, report: 1 }, braggart: { output: 1, report: 1.5 } } }), has: [traitLine("diligent", { outputChange: "30%", reportRise: "0%", limit: "20" }), traitLine("braggart", { outputChange: "0%", reportRise: "50%", limit: "20" }), traitLine("empire-builder", { outputChange: "0%", reportRise: "20%", limit: "20" })] },
	{ name: "the term range and death chance read from tuning", topic: "governors", using: governors({ term: { minTicks: 600, maxTicks: 1200 }, deathPerMille: 50 }), has: [help.governors.terms({ shortest: stepSeconds(600), longest: stepSeconds(1200), death: "5%" }), help.governors.dismissal] },
	{ name: "the true reports sale until it is owned", topic: "governors", has: [help.governors.reports.hidden({ label: archiveEntry(TRUE_REPORTS).label, cost: costText(archiveEntry(TRUE_REPORTS)) })], lacks: [help.governors.reports.shown] },
	{ name: "what true reports show once owned", topic: "governors", unlocks: [TRUE_REPORTS], has: [help.governors.reports.shown], lacks: [help.governors.reports.hidden({ label: archiveEntry(TRUE_REPORTS).label, cost: costText(archiveEntry(TRUE_REPORTS)) })] },
];

describe("help topics", () => {
  test.each(rows)(
    "$topic shows $name",
    ({ topic, using, unlocks, has, lacks }) => {
      const lines = topicLines(topic, using, unlocks);

      for (const line of has ?? []) expect(lines).toContain(line);
      for (const line of lacks ?? []) expect(lines).not.toContain(line);
    },
  );

  test("prose that names a key takes the key from the bindings", () => {
    const named = [
      [
        "keys",
        help.keys.assignJobs({
          farmKey: peasantKeyFor(Job.FARM),
          forestKey: peasantKeyFor(Job.FOREST),
          mineKey: peasantKeyFor(Job.MINE),
          idleKey: peasantKeyFor(Job.IDLE),
        }),
      ],
      ["desk", help.desk.openDesk({ key: keymap.keyFor("court") })],
      ["crown", help.crown.deliver({ key: keymap.keyFor("crown") })],
      ["decrees", help.decrees.howToIssue({ key: keymap.keyFor("decrees") })],
      ["illusion", help.illusion.conjure({ key: keymap.keyFor("ledger") })],
    ] as const;

    for (const [topic, line] of named) {
      expect(topicLines(topic)).toContain(line);
    }
  });

  test("the keys topic lists every key hint the player owns, with labels in one column", () => {
    const owned = [ARCHIVE_PANEL, PALETTE_UNLOCK, CONJURING];

    const lines = topicLines("keys", tuning, owned);

    const columns = keymap.keyHints(owned).map((hint) => {
      const row = lines.find((line) => line.startsWith(hint.keys));
      expect(row?.trimEnd().endsWith(hint.label)).toBe(true);
      return (row?.trimEnd().length ?? 0) - hint.label.length;
    });
    expect(new Set(columns).size).toBe(1);
  });
});

describe("help quotes the tuning that owned upgrades have changed", () => {
  const ids = ["lenders.favor", "store.granary1", "governors.physician"];

  test("the interest, grain store and governor death figures follow the upgrades the village owns", () => {
    const interest =
      tuning.illusion.interestPerSeason * effectOf("lenders.favor", "interest");
    const grainCap =
      tuning.economy.caps.grain + effectOf("store.granary1", "grainCap");
    const death =
      (tuning.governors.deathPerMille *
        effectOf("governors.physician", "governorDeath")) /
      1000;

    const illusionText = topicLines("illusion", tuning, ids).join("\n");
    const grainText = topicLines("grain", tuning, ids).join("\n");
    const governorText = topicLines("governors", tuning, ids).join("\n");

    expect(illusionText).toContain(percent(interest));
    expect(grainText).toContain(`${plain(grainCap)} grain`);
    expect(governorText).toContain(`${percent(death)} chance`);
  });

  test("without the upgrades the same topics quote the base figures", () => {
    const illusionText = topicLines("illusion").join("\n");
    const governorText = topicLines("governors").join("\n");

    expect(illusionText).toContain(percent(tuning.illusion.interestPerSeason));
    expect(governorText).toContain(
      `${percent(tuning.governors.deathPerMille / 1000)} chance`,
    );
  });
});
