import type { CrownView } from "./crown";
import { compareKeys, sortedKeys } from "./data";
import type { Decree } from "./decree";
import type { DeskEntryView } from "./desk";
import type { Game } from "./game";
import type { FormerGovernorView, GovernorView } from "./governors";
import type { IllusionView } from "./illusion";
import { type Job, RESOURCES, type Season } from "./realm";
import type { ResourceId } from "./state";
import {
  ARCHIVE_PANEL,
  CROWN_PANEL,
  TRUE_REPORTS,
  type UnlockId,
} from "./unlocks";

export type LedgerLine = {
  resource: ResourceId;
  /** Real stock plus conjured units. */
  amount: number;
  /** The conjured part of `amount`. */
  conjured: number;
  ratePerSecond: number;
};
export type DelegateView = {
  id: number;
  name: string;
  job: Job | "idle";
  grudgeTicks: number;
};
export type PanelId = "archive" | "crown" | "ledger" | "peasants";
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
  formerGovernors: FormerGovernorView[];
  crown: CrownView | null;
  illusion: IllusionView | null;
  promotion: { target: number; promotedAt: number; promotedAtSeconds: number };
  growth: { stored: number; needed: number; perSecond: number; full: boolean };
  /** Grain the peasants eat each second, whatever the harvest brings in. */
  grainEatenPerSecond: number;
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
    const { rates, growthPerTick, eatenPerTick } = this.game.projection.flows();
    // The projection runs the next tick, so the gap is read at that tick too.
    const gap = this.game.unlocks.enabled(TRUE_REPORTS)
      ? null
      : this.game.governors.reportGap(this.tick + 1);
    const ledger: LedgerLine[] = RESOURCES.map((resource) => ({
      resource,
      amount: this.game.illusion.apparent(resource),
      conjured: this.game.illusion.conjuredOf(resource),
      ratePerSecond:
        ((rates[resource] + (gap?.[resource] ?? 0)) * 1000) /
        this.tuning.stepMs,
    }));
    const { decrees } = this.posting;
    const labor = this.game.delegates.jobCounts();
    return {
      tick: this.tick,
      elapsedSeconds: (this.tick * this.tuning.stepMs) / 1000,
      ledger,
      realm: {
        population: this.game.delegates.population,
        labor,
        season: this.game.economy.seasonAt(this.tick),
        starved: this.posting.economy.starved,
      },
      delegates: this.game.delegates.peasants.map((delegate) => ({
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
      desk: this.game.desk.view(),
      governors: this.game.governors.view(),
      formerGovernors: this.game.governors.formerView(),
      crown: this.game.crown.view(),
      illusion: this.game.illusion.view(),
      promotion: {
        target: this.tuning.village.promotionPopulation,
        promotedAt: this.career.promotedAt,
        promotedAtSeconds: (this.career.promotedAt * this.tuning.stepMs) / 1000,
      },
      growth: {
        stored: this.posting.economy.growth,
        needed: this.tuning.economy.grainPerPeasant,
        perSecond: (growthPerTick * 1000) / this.tuning.stepMs,
        full: !this.game.economy.hasRoom,
      },
      grainEatenPerSecond: (eatenPerTick * 1000) / this.tuning.stepMs,
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
          affordable: this.game.illusion.apparent("coin") >= entry.cost,
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
}
