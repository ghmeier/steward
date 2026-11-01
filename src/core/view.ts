import { compareKeys, sortedKeys } from "./data";
import type { Decree } from "./decree";
import { fillNames } from "./desk";
import type { Game } from "./game";
import { type Job, RESOURCES, type Season } from "./realm";
import type { ResourceId } from "./state";
import { ARCHIVE_PANEL, CROWN_PANEL, type UnlockId } from "./unlocks";

export type LedgerLine = {
  resource: ResourceId;
  amount: number;
  ratePerSecond: number;
};
export type DeskOptionView = {
  id: string;
  label: string;
  affordable: boolean;
  expiry: boolean;
  /** Resource deltas, keys sorted. */
  resources: Record<string, number>;
  /** Which party will sulk if this option is chosen. */
  grudge: "first" | "second" | "none";
};
export type DeskEntryView = {
  id: number;
  label: string;
  /** Names of the two parties, so an option's grudge can be shown by name. */
  parties: [string, string];
  options: DeskOptionView[];
};
export type GovernorView = { id: string; name: string };
export type DelegateView = {
  id: number;
  name: string;
  job: Job | "idle";
  grudgeTicks: number;
};
export type PanelId = "crown" | "desk" | "ledger" | "peasants";
export type CrownDemandView = { label: string };
export type GameView = {
  tick: number;
  elapsedSeconds: number;
  ledger: LedgerLine[];
  realm: {
    population: number;
    labor: Record<Job, number>;
    season: Season;
    /** Running total of peasants lost to hunger. */
    starved: number;
  };
  delegates: DelegateView[];
  decrees: Decree[];
  savedDecrees: Decree[];
  desk: DeskEntryView[];
  governors: GovernorView[];
  crown: CrownDemandView | null;
  promotion: { target: number; promotedAt: number; promotedAtSeconds: number };
  growth: { stored: number; needed: number; perSecond: number; full: boolean };
  lockedPanels: PanelId[];
  unlocks: UnlockId[];
  archive: { open: boolean; entries: ArchiveEntryView[] };
};
export type ArchiveEntryView = {
  id: UnlockId;
  label: string;
  description: string;
  cost: number;
  owned: boolean;
  affordable: boolean;
  /** Every prerequisite is owned. */
  available: boolean;
};

export class ViewManager {
  constructor(private game: Game) {}

  // The view is plain truth only in phase 2. Illusion, governor exaggeration and
  // unlock filtering are applied here in later phases, so the UI must never read
  // GameState directly.
  compute(): GameView {
    const { rates, growthPerTick } = this.game.projection.flows();
    const ledger: LedgerLine[] = RESOURCES.map((resource) => ({
      resource,
      amount: this.game.state.posting.resources[resource] ?? 0,
      ratePerSecond: (rates[resource] * 1000) / this.game.tuning.stepMs,
    }));
    const { delegates, decrees } = this.game.state.posting;
    const labor = this.game.delegates.jobCounts();
    return {
      tick: this.game.state.tick,
      elapsedSeconds: (this.game.state.tick * this.game.tuning.stepMs) / 1000,
      ledger,
      realm: {
        population: delegates.length,
        labor,
        season: this.game.economy.seasonAt(this.game.state.tick),
        starved: this.game.state.posting.economy.starved,
      },
      delegates: delegates.map((delegate) => ({
        id: delegate.id,
        name: delegate.name,
        job: delegate.job,
        grudgeTicks: Math.max(0, delegate.grudgeUntil - this.game.state.tick),
      })),
      decrees: Object.entries(decrees)
        .sort(([a], [b]) => compareKeys(a, b))
        .map(([, decree]) => structuredClone(decree)),
      savedDecrees: sortedKeys(this.game.state.career.savedDecrees).flatMap(
        (name) => {
          const saved = this.game.state.career.savedDecrees[name];
          return saved === undefined ? [] : [structuredClone(saved)];
        },
      ),
      desk: this.deskEntries(),
      governors: [],
      crown: null,
      promotion: {
        target: this.game.tuning.village.promotionPopulation,
        promotedAt: this.game.state.career.promotedAt,
        promotedAtSeconds:
          (this.game.state.career.promotedAt * this.game.tuning.stepMs) / 1000,
      },
      growth: {
        stored: this.game.state.posting.economy.growth,
        needed: this.game.tuning.economy.grainPerPeasant,
        perSecond: (growthPerTick * 1000) / this.game.tuning.stepMs,
        full: delegates.length >= this.game.tuning.economy.maxPopulation,
      },
      lockedPanels: this.game.unlocks.enabled(CROWN_PANEL) ? [] : ["crown"],
      unlocks: this.game.unlocks.purchased,
      archive: {
        open: this.game.unlocks.enabled(ARCHIVE_PANEL),
        entries: this.game.tuning.archive.entries.map((entry) => ({
          id: entry.id,
          label: entry.label,
          description: entry.description,
          cost: entry.cost,
          owned: this.game.unlocks.enabled(entry.id),
          affordable:
            (this.game.state.posting.resources.coin ?? 0) >= entry.cost,
          available: entry.requires.every((id) =>
            this.game.unlocks.enabled(id),
          ),
        })),
      },
    };
  }

  private deskEntries(): DeskEntryView[] {
    const { delegates, desk } = this.game.state.posting;
    const nameOf = (id: number) => {
      const found = delegates.find((delegate) => delegate.id === id);
      if (found === undefined)
        throw new Error(`dispute party ${id} is not in the roster`);
      return found.name;
    };
    return desk.disputes.map((dispute) => {
      const template = this.game.desk.templateOf(dispute);
      const first = nameOf(dispute.parties[0]);
      const second = nameOf(dispute.parties[1]);
      return {
        id: dispute.id,
        label: fillNames(template.text, first, second),
        parties: [first, second],
        options: template.options.map((option) => ({
          id: option.id,
          label: fillNames(option.label, first, second),
          affordable: this.game.desk.shortfall(option) === null,
          expiry: option.id === template.expiry,
          resources: sortedResources(option.resources ?? {}),
          grudge: option.grudge ?? "none",
        })),
      };
    });
  }
}

function sortedResources(resources: Record<string, number>) {
  const sorted: Record<string, number> = {};
  for (const key of sortedKeys(resources)) sorted[key] = resources[key] ?? 0;
  return sorted;
}
