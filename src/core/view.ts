import { compareKeys, sortedKeys } from "./data";
import type { Decree } from "./decree";
import { fillNames, shortfall, templateOf } from "./desk";
import { type Job, RESOURCES, type Season } from "./realm";
import type { GameStateManager, ResourceId } from "./state";
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
  constructor(private manager: GameStateManager) {}

  // The view is plain truth only in phase 2. Illusion, governor exaggeration and
  // unlock filtering are applied here in later phases, so the UI must never read
  // GameState directly.
  compute(): GameView {
    const { rates, growthPerTick } = this.manager.pm.flows();
    const ledger: LedgerLine[] = RESOURCES.map((resource) => ({
      resource,
      amount: this.manager.state.posting.resources[resource] ?? 0,
      ratePerSecond: (rates[resource] * 1000) / this.manager.tuning.stepMs,
    }));
    const { delegates, decrees } = this.manager.state.posting;
    const labor = this.manager.dm.jobCounts();
    return {
      tick: this.manager.state.tick,
      elapsedSeconds:
        (this.manager.state.tick * this.manager.tuning.stepMs) / 1000,
      ledger,
      realm: {
        population: delegates.length,
        labor,
        season: this.manager.em.seasonAt(this.manager.state.tick),
        starved: this.manager.state.posting.economy.starved,
      },
      delegates: delegates.map((delegate) => ({
        id: delegate.id,
        name: delegate.name,
        job: delegate.job,
        grudgeTicks: Math.max(
          0,
          delegate.grudgeUntil - this.manager.state.tick,
        ),
      })),
      decrees: Object.entries(decrees)
        .sort(([a], [b]) => compareKeys(a, b))
        .map(([, decree]) => structuredClone(decree)),
      savedDecrees: sortedKeys(this.manager.state.career.savedDecrees).flatMap(
        (name) => {
          const saved = this.manager.state.career.savedDecrees[name];
          return saved === undefined ? [] : [structuredClone(saved)];
        },
      ),
      desk: this.desk(),
      governors: [],
      crown: null,
      promotion: {
        target: this.manager.tuning.village.promotionPopulation,
        promotedAt: this.manager.state.career.promotedAt,
        promotedAtSeconds:
          (this.manager.state.career.promotedAt * this.manager.tuning.stepMs) /
          1000,
      },
      growth: {
        stored: this.manager.state.posting.economy.growth,
        needed: this.manager.tuning.economy.grainPerPeasant,
        perSecond: (growthPerTick * 1000) / this.manager.tuning.stepMs,
        full: delegates.length >= this.manager.tuning.economy.maxPopulation,
      },
      lockedPanels: this.manager.um.enabled(CROWN_PANEL) ? [] : ["crown"],
      unlocks: this.manager.um.purchased,
      archive: {
        open: this.manager.um.enabled(ARCHIVE_PANEL),
        entries: this.manager.tuning.archive.entries.map((entry) => ({
          id: entry.id,
          label: entry.label,
          description: entry.description,
          cost: entry.cost,
          owned: this.manager.um.enabled(entry.id),
          affordable:
            (this.manager.state.posting.resources.coin ?? 0) >= entry.cost,
          available: entry.requires.every((id) => this.manager.um.enabled(id)),
        })),
      },
    };
  }

  private desk(): DeskEntryView[] {
    const { delegates, desk } = this.manager.state.posting;
    const nameOf = (id: number) => {
      const found = delegates.find((delegate) => delegate.id === id);
      if (found === undefined)
        throw new Error(`dispute party ${id} is not in the roster`);
      return found.name;
    };
    return desk.disputes.map((dispute) => {
      const template = templateOf(dispute, this.manager.tuning);
      const first = nameOf(dispute.parties[0]);
      const second = nameOf(dispute.parties[1]);
      return {
        id: dispute.id,
        label: fillNames(template.text, first, second),
        parties: [first, second],
        options: template.options.map((option) => ({
          id: option.id,
          label: fillNames(option.label, first, second),
          affordable: shortfall(this.manager.state, option) === null,
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
