import archiveJson from "../data/archive.json";
import crownJson from "../data/crown.json";
import deskJson from "../data/desk.json";
import governorsJson from "../data/governors.json";
import illusionJson from "../data/illusion.json";
import tuningJson from "../data/tuning.json";
import villageJson from "../data/village.json";
import type { Delegate, Governor } from "../src/core/delegates";
import { Game } from "../src/core/game";
import type { AddContext } from "../src/core/math";
import { JOBS, Job } from "../src/core/realm";
import { parseTuning, type Tuning } from "../src/core/tuning";
import { ARCHIVE_PANEL } from "../src/core/unlocks";
import { type HelpTopicId, helpSections } from "../src/tui/help-menu";

export const fullTuningJson = {
  ...tuningJson,
  village: villageJson,
  desk: deskJson,
  archive: archiveJson,
  crown: crownJson,
  illusion: illusionJson,
  governors: governorsJson,
};

export const tuning = parseTuning(fullTuningJson);

// Balancing edits data/tuning.json, so tests that assert hand-computed economy numbers use these literals.
export const economyTestTuning: Tuning = {
  stepMs: 100,
  maxResourceValue: 1e300,
  decrees: { maxRules: 4, maxConditionNodes: 8, maxConditionDepth: 3 },
  economy: {
    ticksPerSeason: 600,
    seasonYield: { autumn: 1, spring: 1, summer: 1.5, winter: 0 },
    grainPerFarmer: 0.025,
    woodPerWorker: 0.02,
    orePerWorker: 0.01,
    grainPerPerson: 0.01,
    grainPrice: 0.5,
    woodPrice: 0.5,
    orePrice: 1,
    grainPerPeasant: 30,
    maxPopulation: 40,
    laborMovesPerTick: 1,
    initialPopulation: 10,
    initialResources: { coin: 0, grain: 60, ore: 0, wood: 0 },
    laborAllocations: {
      balanced: { farm: 0.5, forest: 0.3, mine: 0.2 },
      farming: { farm: 0.7, forest: 0.2, mine: 0.1 },
    },
  },
  village: {
    names: villageJson.names,
    promotionPopulation: 12,
  },
  desk: {
    slots: 3,
    arrival: { minTicks: 900, maxTicks: 1800 },
    grudgeTicks: 600,
    kinds: {
      dispute: {
        weight: 1,
        templates: [
          {
            id: "boundary",
            text: "{first} accuses {second} of moving a stone.",
            options: [
              {
                id: "pay",
                label: "Pay the surveyor",
                resources: { coin: -10 },
              },
              {
                id: "for-first",
                label: "Rule for {first}",
                resources: { grain: 5 },
                grudge: "second",
              },
              {
                id: "for-second",
                label: "Rule for {second}",
                grudge: "first",
              },
            ],
            expiry: "pay",
            expired: "The surveyor charged {first} and {second} alike.",
          },
          {
            id: "hen",
            text: "{second} kept {first}'s hen.",
            options: [
              { id: "buy", label: "Buy a hen", resources: { grain: -10 } },
              { id: "dismiss", label: "Dismiss it" },
            ],
            expiry: "buy",
            expired: "A hen was bought for {first}.",
          },
        ],
      },
      merchant: {
        weight: 1,
        templates: [
          {
            id: "ore-buyer",
            text: "A smith wants ore at twice the market price.",
            options: [
              {
                id: "sell",
                label: "Sell ten ore",
                resources: { ore: -10, coin: 20 },
              },
              { id: "decline", label: "Send him on" },
            ],
            expiry: "decline",
            expired: "The smith moved on.",
          },
        ],
      },
      traveller: {
        weight: 1,
        templates: [
          {
            id: "settler",
            text: "A traveller asks to settle.",
            options: [
              {
                id: "admit",
                label: "Let them settle",
                resources: { grain: -30 },
                newcomer: true,
              },
              { id: "turn-away", label: "Send them on" },
            ],
            expiry: "turn-away",
            expired: "The traveller walked on.",
          },
        ],
      },
      candidate: tuning.desk.kinds.candidate,
      audit: {
        templates: [
          {
            id: "inspection",
            text: "The auditors have arrived.",
            options: [
              { id: "back", label: "Cover the books" },
              { id: "deepen", label: "Pay for a deeper illusion" },
            ],
            expired: "The auditors took what they found.",
          },
        ],
      },
    },
  },
  archive: tuning.archive,
  crown: tuning.crown,
  illusion: tuning.illusion,
  governors: tuning.governors,
};

export const quietOptions = { absorbed: null, validateEvery: 0 } as const;

export type RosterCounts = Partial<Record<Job, number>>;

/** Ids ascend in the order farm, forest, mine, idle, so lowest-id expectations are easy to state. */
export function rosterOf(counts: RosterCounts): Delegate[] {
  const delegates: Delegate[] = [];
  for (const job of JOBS) {
    for (let i = 0; i < (counts[job] ?? 0); i++) {
      const id = delegates.length + 1;
      delegates.push({
        id,
        name: villageJson.names[id - 1] as string,
        kind: "peasant",
        job,
        grudgeUntil: 0,
      });
    }
  }
  return delegates;
}

let governorCount = 0;

/** A governor of the first of the village's names not used by `rosterOf`, so names stay unique alongside a small peasant roster. */
export function governorOf(fields: Partial<Governor> = {}): Governor {
  governorCount += 1;
  return {
    id: 1000 + governorCount,
    name: villageJson.names[villageJson.names.length - governorCount] as string,
    kind: "governor",
    job: Job.FARM,
    grudgeUntil: 0,
    village: 8,
    traits: [],
    hiredAt: 0,
    termEndsAt: 1_000_000,
    hoard: 0,
    ...fields,
  };
}

/** Puts governors after the peasants, renumbering them so ids still ascend. */
export function addGovernors(game: Game, ...governors: Governor[]): Governor[] {
  const { posting } = game.state;
  const added = governors.map((governor) => {
    const id = posting.nextDelegateId;
    posting.nextDelegateId += 1;
    return { ...governor, id };
  });
  posting.delegates.push(...added);
  return added;
}

export function setRoster(game: Game, counts: RosterCounts): void {
  game.state.posting.delegates = rosterOf(counts);
  game.state.posting.nextDelegateId = game.state.posting.delegates.length + 1;
}

export function contextFor(game: Game): AddContext {
  return { tick: game.state.tick, maxValue: 1e300, absorbed: null };
}

export function grantUnlocks(game: Game, ids: readonly string[]): void {
  for (const id of ids) game.state.career.unlocks[id] = 0;
}

/** The ten-peasant village the sample command log was written for, so the desk and multi-peasant labor stay covered. */
export function sampleVillage(seed: number): Game {
  const game = Game.create(seed, tuning);
  setRoster(game, { idle: 10 });
  grantUnlocks(game, [
    ARCHIVE_PANEL,
    ...tuning.archive.entries.map((entry) => entry.id),
  ]);
  return game;
}

/** Arranges a famine so that the next unfed tick brings the total deaths due up to `totalDeaths`. */
export function setFamineDue(
  game: Game,
  totalDeaths: number,
  ticksPerSeason: number,
): void {
  game.state.posting.economy.famine = {
    startPopulation: 2 * totalDeaths,
    ticks: ticksPerSeason - 1,
    deaths: game.state.posting.economy.famine.deaths,
  };
}

/** The lines of one help topic, as they appear under its heading on the Help page. */
export function topicLines(
  topic: HelpTopicId,
  using: Tuning = tuning,
  unlocks: readonly string[] = [],
): string[] {
  const game = Game.create(1, using);
  grantUnlocks(game, unlocks);
  const context = { view: game.view.compute(), tuning: using };
  const section = helpSections(context).find((s) => s.id === topic);
  if (section === undefined) throw new Error(`no help topic ${topic}`);
  return section.lines;
}
