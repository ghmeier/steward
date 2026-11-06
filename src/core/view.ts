import { compareKeys, sortedKeys } from "./data";
import type { Decree } from "./decree";
import { fillNames } from "./desk";
import type { Game } from "./game";
import { type Job, RESOURCES, type Resource, type Season } from "./realm";
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
export type PanelId = "archive" | "crown" | "ledger" | "peasants";
export type CrownDemandView = {
  resource: ResourceId;
  amount: number;
  delivered: number;
  ticksLeft: number;
  herald: string;
};
/** What the Crown panel shows; null before promotion, when the crown has made no demands. */
export type CrownView = {
  demand: CrownDemandView | null;
  /** Ticks until the next demand while none is open; null while one is open. */
  nextDemandTicks: number | null;
  met: number;
  missed: number;
};
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
  crown: CrownView | null;
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

  private get posting() {
    return this.game.state.posting;
  }

  private get career() {
    return this.game.state.career;
  }

  private get tick() {
    return this.game.state.tick;
  }

  private get tuning() {
    return this.game.tuning;
  }

  // The UI reads only this view, never GameState, so what the player is shown can
  // differ from the underlying truth without touching any renderer.
  compute(): GameView {
    const { rates, growthPerTick } = this.game.projection.flows();
    const ledger: LedgerLine[] = RESOURCES.map((resource) => ({
      resource,
      amount: this.posting.resources[resource] ?? 0,
      ratePerSecond: (rates[resource] * 1000) / this.tuning.stepMs,
    }));
    const { delegates, decrees } = this.posting;
    const labor = this.game.delegates.jobCounts();
    return {
      tick: this.tick,
      elapsedSeconds: (this.tick * this.tuning.stepMs) / 1000,
      ledger,
      realm: {
        population: delegates.length,
        labor,
        season: this.game.economy.seasonAt(this.tick),
        starved: this.posting.economy.starved,
      },
      delegates: delegates.map((delegate) => ({
        id: delegate.id,
        name: delegate.name,
        job: delegate.job,
        grudgeTicks: Math.max(0, delegate.grudgeUntil - this.tick),
      })),
      decrees: Object.entries(decrees)
        .sort(([a], [b]) => compareKeys(a, b))
        .map(([, decree]) => structuredClone(decree)),
      savedDecrees: sortedKeys(this.career.savedDecrees).flatMap((name) => {
        const saved = this.career.savedDecrees[name];
        return saved === undefined ? [] : [structuredClone(saved)];
      }),
      desk: this.deskEntries(),
      governors: [],
      crown: this.crownView(),
      promotion: {
        target: this.tuning.village.promotionPopulation,
        promotedAt: this.career.promotedAt,
        promotedAtSeconds: (this.career.promotedAt * this.tuning.stepMs) / 1000,
      },
      growth: {
        stored: this.posting.economy.growth,
        needed: this.tuning.economy.grainPerPeasant,
        perSecond: (growthPerTick * 1000) / this.tuning.stepMs,
        full: delegates.length >= this.tuning.economy.maxPopulation,
      },
      lockedPanels: this.lockedPanels(),
      unlocks: this.game.unlocks.purchased,
      archive: {
        open: this.game.unlocks.enabled(ARCHIVE_PANEL),
        entries: this.tuning.archive.entries.map((entry) => ({
          id: entry.id,
          label: entry.label,
          description: entry.description,
          cost: entry.cost,
          owned: this.game.unlocks.enabled(entry.id),
          affordable: (this.posting.resources.coin ?? 0) >= entry.cost,
          available: entry.requires.every((id) =>
            this.game.unlocks.enabled(id),
          ),
        })),
      },
    };
  }

  private lockedPanels(): PanelId[] {
    const locked: PanelId[] = [];
    if (!this.game.unlocks.enabled(ARCHIVE_PANEL)) locked.push("archive");
    if (!this.game.unlocks.enabled(CROWN_PANEL)) locked.push("crown");
    return locked;
  }

  private crownView(): CrownView | null {
    if (!this.game.unlocks.enabled(CROWN_PANEL)) return null;
    const { demand, nextDemandTick, met, missed } = this.posting.crown;
    const open = this.game.crown.isOpen;
    return {
      demand: open
        ? {
            resource: demand.resource,
            amount: demand.amount,
            delivered: demand.delivered,
            ticksLeft: Math.max(0, demand.dueAt - this.tick),
            herald: this.tuning.crown.lines[
              demand.resource as Resource
            ].herald.replaceAll("{amount}", String(demand.amount)),
          }
        : null,
      nextDemandTicks: open ? null : Math.max(0, nextDemandTick - this.tick),
      met,
      missed,
    };
  }

  private deskEntries(): DeskEntryView[] {
    const { delegates, desk } = this.posting;
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
