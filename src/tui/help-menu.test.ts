import { describe, expect, test } from "bun:test";
import { topicLines, tuning } from "../../test/helpers";
import { copy } from "../core/copy";
import { policiesFor } from "../core/decree";
import { Job } from "../core/realm";
import type { Tuning } from "../core/tuning";
import {
  ARCHIVE_PANEL,
  CHAINING_UNLOCK,
  COMPOUND_UNLOCK,
  CONJURING,
  PALETTE_UNLOCK,
  SAVED_DECREES_UNLOCK,
} from "../core/unlocks";
import { describePolicy, plain } from "./decree-format";
import type { HelpTopicId } from "./help-menu";
import { keyFor, keyHints, peasantKeyFor } from "./keys";

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
const desk = (changes: Partial<Tuning["desk"]>): Tuning => ({
  ...tuning,
  desk: { ...tuning.desk, ...changes },
});

function rulingsWith(resources: Record<string, number>): Tuning {
  const free = ({ templates }: Tuning["desk"]["kinds"]["merchant"]) =>
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
const stepSeconds = (ticks: number) => `${ticks / 10} s`;

// biome-ignore format: one row per line keeps the table scannable
const rows: Row[] = [
	{ name: "coin prices", topic: "coin", using: economy({ grainPrice: 0.25, woodPrice: 0.75, orePrice: 3 }), has: [help.coin.steadySource({ grainPrice: "0.25", woodPrice: "0.75", orePrice: "3" })] },
	{ name: "feeding cost, population cap and season length", topic: "grain", using: economy({ grainPerPeasant: 45, maxPopulation: 77, ticksPerSeason: 1200, seasonYield: fertile }), has: [help.grain.newPeasants({ grain: "45" }), help.grain.populationCap({ maxPopulation: "77" }), help.grain.seasonLasts({ duration: stepSeconds(1200) })] },
	{ name: "year-round average feeding", topic: "grain", using: economy({ grainPerFarmer: 0.03, grainPerPerson: 0.01, seasonYield: { spring: 0.5, summer: 1, autumn: 0.5, winter: 0 } }), has: [help.grain.peasantsEat({ rate: "0.1/s", feeds: "1.5" })] },
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
	{ name: "the Archive once open", topic: "coin", unlocks: [ARCHIVE_PANEL], has: [help.coin.archiveBuys({ key: keyFor("archive") })] },
	{ name: "no Archive before it opens", topic: "coin", lacks: [help.coin.archiveBuys({ key: keyFor("archive") })] },
	{ name: "decrees before any unlock", topic: "decrees", lacks: [help.decrees.compound, help.decrees.chaining, help.decrees.saved] },
	{ name: "compound conditions once owned", topic: "decrees", unlocks: [COMPOUND_UNLOCK], has: [help.decrees.compound] },
	{ name: "chaining once owned", topic: "decrees", unlocks: [CHAINING_UNLOCK], has: [help.decrees.chaining] },
	{ name: "saved decrees once owned", topic: "decrees", unlocks: [SAVED_DECREES_UNLOCK], has: [help.decrees.saved] },
	{ name: "the lot, the ceiling and the fade read from tuning", topic: "illusion", using: illusion({ lot: 40, ceilingPerPeasant: 12, fadePerTick: 0.00115 }), has: [help.illusion.teaches({ lot: "40" }), help.illusion.ceiling({ ceiling: "12", grainAndWoodPrice: plain(tuning.economy.grainPrice), oreAndCoinPrice: plain(tuning.economy.orePrice) }), help.illusion.fades({ fade: "50%" })] },
	{ name: "the audit timings and the deeper illusion read from tuning", topic: "illusion", using: illusion({ audit: { ...tuning.illusion.audit, debtShare: 0.4, ageTicks: 1200, warningTicks: 300, deadlineTicks: 600, deepenCost: 0.25, deepenGrowth: 2 } }), has: [help.illusion.auditors({ debtShare: "40%", seasons: "2", warning: "30 s", deadline: "60 s" }), help.illusion.outcomes({ cost: "25%", growth: "2" })] },
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
      ["desk", help.desk.openDesk({ key: keyFor("court") })],
      ["crown", help.crown.deliver({ key: keyFor("crown") })],
      ["decrees", help.decrees.howToIssue({ key: keyFor("decrees") })],
      ["illusion", help.illusion.conjure({ key: keyFor("ledger") })],
    ] as const;

    for (const [topic, line] of named) {
      expect(topicLines(topic)).toContain(line);
    }
  });

  test("the keys topic lists every key hint the player owns, with labels in one column", () => {
    const owned = [ARCHIVE_PANEL, PALETTE_UNLOCK, CONJURING];

    const lines = topicLines("keys", tuning, owned);

    const columns = keyHints(owned).map((hint) => {
      const row = lines.find((line) => line.startsWith(hint.keys));
      expect(row?.trimEnd().endsWith(hint.label)).toBe(true);
      return (row?.trimEnd().length ?? 0) - hint.label.length;
    });
    expect(new Set(columns).size).toBe(1);
  });
});
