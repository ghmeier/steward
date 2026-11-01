import archiveJson from "../data/archive.json";
import tuningJson from "../data/tuning.json";
import villageJson from "../data/village.json";
import type { Delegate } from "../src/core/delegates";
import type { AddContext } from "../src/core/math";
import { createNewGame, type GameState } from "../src/core/state";
import { parseTuning, type Tuning } from "../src/core/tuning";
import { ARCHIVE_PANEL } from "../src/core/unlocks";
import { computeView } from "../src/core/view";
import { helpMenu } from "../src/tui/help-menu";
import { menuKey, openMenu, renderMenu } from "../src/tui/menu";

export const fullTuningJson = {
  ...tuningJson,
  village: villageJson,
  archive: archiveJson,
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
    deskSlots: 3,
    promotionPopulation: 12,
    disputeArrival: { minTicks: 900, maxTicks: 1800 },
    grudgeTicks: 600,
    disputes: [
      {
        id: "boundary",
        text: "{first} accuses {second} of moving a stone.",
        options: [
          { id: "pay", label: "Pay the surveyor", resources: { coin: -10 } },
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
      },
      {
        id: "hen",
        text: "{second} kept {first}'s hen.",
        options: [
          { id: "buy", label: "Buy a hen", resources: { grain: -10 } },
          { id: "dismiss", label: "Dismiss it" },
        ],
        expiry: "buy",
      },
    ],
  },
  archive: tuning.archive,
};

export const quietOptions = { absorbed: null, validate: false } as const;

export type RosterCounts = {
  farm?: number;
  forest?: number;
  mine?: number;
  idle?: number;
};

/** Ids ascend in the order farm, forest, mine, idle, so lowest-id expectations are easy to state. */
export function rosterOf(counts: RosterCounts): Delegate[] {
  const jobs = ["farm", "forest", "mine", "idle"] as const;
  const delegates: Delegate[] = [];
  for (const job of jobs) {
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

export function setRoster(state: GameState, counts: RosterCounts): void {
  state.posting.delegates = rosterOf(counts);
  state.posting.nextDelegateId = state.posting.delegates.length + 1;
}

export function contextFor(state: GameState): AddContext {
  return { tick: state.tick, maxValue: 1e300, absorbed: null };
}

export function grantUnlocks(state: GameState, ids: readonly string[]): void {
  for (const id of ids) state.career.unlocks[id] = 0;
}

/** The ten-peasant village the sample command log was written for, so the desk and multi-peasant labor stay covered. */
export function sampleVillage(seed: number): GameState {
  const state = createNewGame(seed, tuning);
  setRoster(state, { idle: 10 });
  grantUnlocks(state, [
    ARCHIVE_PANEL,
    ...tuning.archive.entries.map((entry) => entry.id),
  ]);
  return state;
}

/** Arranges a famine so that the next unfed tick brings the total deaths due up to `totalDeaths`. */
export function setFamineDue(
  state: GameState,
  totalDeaths: number,
  ticksPerSeason: number,
): void {
  state.posting.economy.famine = {
    startPopulation: 2 * totalDeaths,
    ticks: ticksPerSeason - 1,
    deaths: state.posting.economy.famine.deaths,
  };
}

/** The text of one help topic, opened through the menu the way a player would. */
export function topicText(
  topic: string,
  using: Tuning = tuning,
  unlocks: readonly string[] = [],
): string {
  const game = createNewGame(1, using);
  grantUnlocks(game, unlocks);
  const context = { view: computeView(game, using), tuning: using };
  const root = openMenu(helpMenu);
  const index = renderMenu(root, context).lines.findIndex((line) =>
    line.includes(topic),
  );
  let state = root;
  const press = (name: string) => {
    const step = menuKey(
      state,
      { name, ctrl: false, meta: false, shift: false, sequence: name },
      context,
    );
    if (step.state === null) throw new Error("menu closed");
    state = step.state;
  };
  for (let i = 0; i < index; i++) press("down");
  press("return");
  return renderMenu(state, context).lines.join("\n");
}
