import type { CrownView } from "./crown";
import type { Decree } from "./decree";
import type { DelegateView } from "./delegates";
import type { DeskEntryView } from "./desk";
import type { Game } from "./game";
import type { FormerGovernorView, GovernorView } from "./governors";
import type { IllusionView } from "./illusion";
import { type CappedResource, type Job, RESOURCES, type Season } from "./realm";
import type { ResourceId } from "./state";
import {
  ARCHIVE_PANEL,
  type ArchiveCostPart,
  CROWN_PANEL,
  type PanelId,
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
  /** What the stores can hold of this resource; absent for coin, which is not stored. */
  cap?: number | undefined;
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
  formerGovernors: FormerGovernorView[];
  crown: CrownView | null;
  illusion: IllusionView | null;
  villageName: string;
  /** The steward's rank, which climbs with promotion and then with the crown's charter and a governor in service. */
  title: string;
  promotion: { target: number; promotedAt: number };
  growth: { stored: number; needed: number; perSecond: number; full: boolean };
  /** Grain the peasants eat each second, whatever the harvest brings in. */
  grainEatenPerSecond: number;
  lockedPanels: PanelId[];
  unlocks: UnlockId[];
  archive: { open: boolean; entries: ArchiveEntryView[] };
  /** The figures upgrades have adjusted, so that help and displays quote what the village really lives by. */
  live: LiveTuning;
};
export type LiveTuning = {
  /** Yields are per worker per tick; farming is before the season's multiplier. */
  yields: { grain: number; wood: number; ore: number };
  prices: { grain: number; wood: number; ore: number };
  caps: Record<CappedResource, number>;
  interestPerSeason: number;
  auditGapTicks: number;
  governorCap: number;
  governorDeathPerMille: number;
};
/** Only entries on offer appear. */
export type ArchiveEntryView = {
  id: UnlockId;
  label: string;
  description: string;
  cost: ArchiveCostPart[];
  /** Every part of the cost is covered. */
  affordable: boolean;
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

  private title(): string {
    const { titles } = this.tuning.village;
    if (this.career.promotedAt === 0) return titles.start;
    const crowned =
      this.game.unlocks.enabled(CROWN_PANEL) &&
      this.game.delegates.governors.length > 0;
    return crowned ? titles.crowned : titles.promoted;
  }

  private live(): LiveTuning {
    const { economy, illusion, governors } = this.game;
    return {
      yields: {
        grain: economy.grainPerFarmer,
        wood: economy.woodPerWorker,
        ore: economy.orePerWorker,
      },
      prices: {
        grain: economy.priceOf("grain"),
        wood: economy.priceOf("wood"),
        ore: economy.priceOf("ore"),
      },
      caps: {
        grain: economy.capOf("grain"),
        wood: economy.capOf("wood"),
        ore: economy.capOf("ore"),
      },
      interestPerSeason: illusion.interestPerSeason,
      auditGapTicks: illusion.auditGapTicks,
      governorCap: governors.cap,
      governorDeathPerMille: governors.deathPerMille,
    };
  }

  // The UI reads only this view, never GameState, so what the player is shown can
  // differ from the underlying truth without touching any renderer.
  compute(): GameView {
    const { rates, growthPerTick, eatenPerTick } = this.game.projection.flows();
    // The projection runs the next tick, so the gap is read at that tick too.
    const gap = this.game.unlocks.enabled(TRUE_REPORTS)
      ? null
      : this.game.governors.reportGap(this.tick + 1);
    const live = this.live();
    const ledger: LedgerLine[] = RESOURCES.map((resource) => ({
      resource,
      amount: this.game.illusion.apparent(resource),
      conjured: this.game.illusion.conjuredOf(resource),
      ...(resource === "coin" ? {} : { cap: live.caps[resource] }),
      ratePerSecond:
        ((rates[resource] + (gap?.[resource] ?? 0)) * 1000) /
        this.tuning.stepMs,
    }));
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
      delegates: this.game.delegates.view(),
      decrees: this.game.decrees.view(),
      savedDecrees: this.game.savedDecrees.view(),
      desk: this.game.desk.view(),
      governors: this.game.governors.view(),
      formerGovernors: this.game.governors.formerView(),
      crown: this.game.crown.view(),
      illusion: this.game.illusion.view(),
      villageName: this.posting.name,
      title: this.title(),
      promotion: {
        target: this.tuning.village.promotionPopulation,
        promotedAt: this.career.promotedAt,
      },
      growth: {
        stored: this.posting.economy.growth,
        needed: this.tuning.economy.grainPerPeasant,
        perSecond: (growthPerTick * 1000) / this.tuning.stepMs,
        full: !this.game.economy.hasRoom,
      },
      grainEatenPerSecond: (eatenPerTick * 1000) / this.tuning.stepMs,
      lockedPanels: this.game.unlocks.lockedPanels(),
      unlocks: this.game.unlocks.purchased,
      live,
      archive: {
        open: this.game.unlocks.enabled(ARCHIVE_PANEL),
        entries: this.game.unlocks.offered().map((entry) => {
          const cost = this.game.unlocks.costParts(entry);
          return {
            id: entry.id,
            label: entry.label,
            description: entry.description,
            cost,
            affordable: cost.every((part) => part.affordable),
          };
        }),
      },
    };
  }
}
