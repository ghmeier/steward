import { describe, expect, test } from "bun:test";
import { topicText, tuning } from "../../test/helpers";
import { policiesFor } from "../core/decree";
import type { Tuning } from "../core/tuning";
import {
  ARCHIVE_PANEL,
  CHAINING_UNLOCK,
  COMPOUND_UNLOCK,
  PALETTE_UNLOCK,
  SAVED_DECREES_UNLOCK,
} from "../core/unlocks";
import { describePolicy } from "./decree-format";
import { keyHints } from "./keys";

const economy = (changes: Partial<Tuning["economy"]>): Tuning => ({
  ...tuning,
  economy: { ...tuning.economy, ...changes },
});
const village = (changes: Partial<Tuning["village"]>): Tuning => ({
  ...tuning,
  village: { ...tuning.village, ...changes },
});
const desk = (changes: Partial<Tuning["desk"]>): Tuning => ({
  ...tuning,
  desk: { ...tuning.desk, ...changes },
});

// Every desk entry is stripped but the first dispute, whose costs are removed, then its first option gets `resources`.
function rulingsWith(resources: Record<string, number>): Tuning {
  const { kinds } = tuning.desk;
  const [first] = kinds.dispute.templates;
  if (first === undefined) throw new Error("no dispute template");
  const [head, ...rest] = first.options.map(({ id, label }) => ({ id, label }));
  if (head === undefined) throw new Error("no option");
  const options = [{ ...head, resources }, ...rest];
  return desk({
    kinds: {
      dispute: { ...kinds.dispute, templates: [{ ...first, options }] },
      merchant: { ...kinds.merchant, templates: [] },
      traveller: { ...kinds.traveller, templates: [] },
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
  economy({ seasonYield: { spring: 1, summer: 1, autumn, winter: 1 } });

type Row = {
  name: string;
  topic: string;
  using?: Tuning;
  unlocks?: string[];
  has?: string[];
  lacks?: string[];
};

// biome-ignore format: one row per line keeps the table scannable
const rows: Row[] = [
	{ name: "coin prices", topic: "Coin", using: economy({ grainPrice: 0.25, woodPrice: 0.75, orePrice: 3 }), has: ["grain at 0.25", "wood at 0.75", "ore at 3"] },
	{ name: "feeding cost, population cap and season length", topic: "Grain and growth", using: economy({ grainPerPeasant: 45, maxPopulation: 77, ticksPerSeason: 1200 }), has: ["every 45 grain", "up to 77 peasants", "season lasts 120 s"] },
	{ name: "year-round average feeding", topic: "Grain and growth", using: economy({ grainPerFarmer: 0.03, grainPerPerson: 0.01, seasonYield: { spring: 0.5, summer: 1, autumn: 0.5, winter: 0 } }), has: ["feeds about 1.5"] },
	{ name: "season of eating cost and famine length", topic: "Grain and growth", using: economy({ grainPerPerson: 0.02, ticksPerSeason: 500 }), has: ["costs each peasant 10 grain", "season (50 s)", "famine"] },
	{ name: "a barren season is named", topic: "Grain and growth", using: barren(0), has: ["Autumn grows nothing"] },
	{ name: "no barren season, no warning", topic: "Grain and growth", using: barren(1), lacks: ["grows nothing"] },
	{ name: "one labor move per tick", topic: "Harvest and labor", using: economy({ laborMovesPerTick: 1 }), has: ["1 peasant moves"] },
	{ name: "several labor moves per tick", topic: "Harvest and labor", using: economy({ laborMovesPerTick: 3 }), has: ["3 peasants move"] },
	{ name: "labor allocation percentages", topic: "Harvest and labor", using: laborChanged, has: ["lumber: farm 10%, forest 80%, mine 10%", ...policiesFor("labor", laborChanged).map((name) => describePolicy("labor", name, laborChanged))] },
	{ name: "wood rate converted with the step length", topic: "Wood and ore", using: { ...economy({ woodPerWorker: 0.03 }), stepMs: 250 }, has: ["cut wood at 0.12/s"] },
	{ name: "desk slots and grudge", topic: "The desk", using: desk({ slots: 5, grudgeTicks: 300 }), has: ["desk of 5 slots", "for 30 s"] },
	{ name: "every kind of entry", topic: "The desk", has: ["dispute", "merchant", "traveller"] },
	{ name: "promotion population", topic: "Promotion", using: village({ promotionPopulation: 33 }), has: ["Reach 33 peasants"] },
	{ name: "wood rulings", topic: "Wood and ore", using: rulingsWith({ wood: -2 }), has: ["Wood pays"], lacks: ["Wood has no use"] },
	{ name: "no wood rulings", topic: "Wood and ore", using: rulingsWith({ coin: -2 }), has: ["Wood has no use", "Ore has no use"] },
	{ name: "ore rulings", topic: "Wood and ore", using: rulingsWith({ ore: -1 }), has: ["Ore pays"], lacks: ["Ore has no use"] },
	{ name: "coin rulings", topic: "Coin", using: rulingsWith({ coin: -2 }), has: ["spent on rulings"], lacks: ["pay coin"] },
	{ name: "coin fines", topic: "Coin", using: rulingsWith({ coin: 2 }), has: ["pay coin"], lacks: ["spent on rulings"] },
	{ name: "the Archive once open", topic: "Coin", unlocks: [ARCHIVE_PANEL], has: ["Archive"] },
	{ name: "no Archive before it opens", topic: "Coin", lacks: ["Archive"] },
	{ name: "decrees before any unlock", topic: "Decrees", lacks: ["and, or or", "chose", "enact"] },
	{ name: "compound conditions once owned", topic: "Decrees", unlocks: [COMPOUND_UNLOCK], has: ["and, or or", "not"] },
	{ name: "chaining once owned", topic: "Decrees", unlocks: [CHAINING_UNLOCK], has: ["chose"] },
	{ name: "saved decrees once owned", topic: "Decrees", unlocks: [SAVED_DECREES_UNLOCK], has: ["save", "enact", "forget"] },
];

describe("help topics", () => {
  test.each(rows)(
    "$topic shows $name",
    ({ topic, using, unlocks, has, lacks }) => {
      const text = topicText(topic, using, unlocks);

      for (const fragment of has ?? []) expect(text).toContain(fragment);
      for (const fragment of lacks ?? []) expect(text).not.toContain(fragment);
    },
  );

  test("the keys topic lists every key hint the player owns", () => {
    const owned = [ARCHIVE_PANEL, PALETTE_UNLOCK];

    const lines = topicText("Keys", tuning, owned).split("\n");

    for (const hint of keyHints(owned)) {
      const row = lines.find((line) => line.startsWith(hint.keys));
      expect(row?.trimEnd().endsWith(hint.label)).toBe(true);
    }
  });
});
