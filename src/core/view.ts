import type { FavorBand } from "./crown";
import { compareKeys, sortedKeys } from "./data";
import type { Decree } from "./decree";
import type { DeskKind } from "./desk";
import type { Game } from "./game";
import type { Books, DebtLine } from "./illusion";
import {
  type Job,
  RESOURCES,
  type Resource,
  type Season,
  type Trait,
} from "./realm";
import type { ResourceId } from "./state";
import {
  ARCHIVE_PANEL,
  CONJURING,
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
export type DeskOptionView = {
  id: string;
  label: string;
  affordable: boolean;
  expiry: boolean;
  /** Resource deltas, keys sorted. */
  resources: Record<string, number>;
  sulker: string | null;
};
export type DeskEntryView = {
  id: number;
  kind: DeskKind;
  label: string;
  /** Ticks until the entry expires on its own deadline; null for an entry that has none. */
  ticksLeft: number | null;
  options: DeskOptionView[];
};
export type GovernorView = {
  id: number;
  name: string;
  job: Job;
  village: number;
  traits: Trait[];
  /** What the governor claims to bring in each second of their job's resource; real output scaled by their report factor. */
  reportedPerSecond: number;
  /** What the governor really brings in and how far the report overshoots it; null until true reports are bought. */
  truth: { realPerSecond: number; gapPerSecond: number } | null;
};
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
  /** The crown's mood toward the steward; the score behind it is never shown. */
  favor: FavorBand;
  demand: CrownDemandView | null;
  /** Ticks until the next demand while none is open; null while one is open. */
  nextDemandTicks: number | null;
  met: number;
  missed: number;
};
/** What the steward sees of the illusion; null until conjuring is unlocked. */
export type IllusionView = {
  books: Books;
  /** Coin value of illusion that can still be added before the ceiling. */
  room: number;
  /** Debt per resource, rounded up to the nearest ten unless exact books are owned. */
  debt: Record<ResourceId, DebtLine>;
  /** Debt is shown to the decimal rather than rounded. */
  debtIsExact: boolean;
  /** Announced auditors have not yet reached the desk. */
  auditOnTheRoad: boolean;
  /** Ticks until announced auditors arrive; null when none are on the road or exact books are not owned. */
  auditInTicks: number | null;
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
      desk: this.deskEntries(),
      governors: this.governorViews(),
      crown: this.crownView(),
      illusion: this.illusionView(),
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

  private governorViews(): GovernorView[] {
    const trueReports = this.game.unlocks.enabled(TRUE_REPORTS);
    const perSecond = (perTick: number) =>
      (perTick * 1000) / this.tuning.stepMs;
    return this.game.delegates.governors.map((governor) => {
      const reported = this.game.governors.reportedOutput(
        governor,
        this.tick + 1,
      );
      const real = this.game.governors.realOutput(governor, this.tick + 1);
      return {
        id: governor.id,
        name: governor.name,
        job: governor.job,
        village: governor.village,
        traits: [...governor.traits],
        reportedPerSecond: perSecond(reported),
        truth: trueReports
          ? {
              realPerSecond: perSecond(real),
              gapPerSecond: perSecond(reported - real),
            }
          : null,
      };
    });
  }

  private lockedPanels(): PanelId[] {
    const locked: PanelId[] = [];
    if (!this.game.unlocks.enabled(ARCHIVE_PANEL)) locked.push("archive");
    if (!this.game.unlocks.enabled(CROWN_PANEL)) locked.push("crown");
    return locked;
  }

  private illusionView(): IllusionView | null {
    if (!this.game.unlocks.enabled(CONJURING)) return null;
    const { books, room, auditInTicks, showsExactDebt } = this.game.illusion;
    return {
      books,
      room,
      debt: this.game.illusion.debtLines(),
      debtIsExact: showsExactDebt,
      auditOnTheRoad: auditInTicks !== null,
      auditInTicks: showsExactDebt ? auditInTicks : null,
    };
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
            ticksLeft: demand.dueAt - this.tick,
            herald: this.tuning.crown.lines[
              demand.resource as Resource
            ].herald.replaceAll("{amount}", String(demand.amount)),
          }
        : null,
      nextDemandTicks: open ? null : nextDemandTick - this.tick,
      met,
      missed,
      favor: this.game.crown.band,
    };
  }

  private deskEntries(): DeskEntryView[] {
    const { desk } = this.game;
    return this.posting.desk.disputes.map((entry) => {
      const template = desk.templateOf(entry);
      return {
        id: entry.id,
        kind: entry.kind,
        label: desk.fill(entry, template.text),
        ticksLeft: entry.kind === "audit" ? entry.dueAt - this.tick : null,
        options: template.options.map((option) => ({
          id: option.id,
          label: desk.fill(entry, option.label),
          affordable: desk.shortfall(entry, option) === null,
          expiry: option.id === template.expiry,
          resources: sortedResources(desk.deltasOf(entry, option)),
          sulker: desk.sulker(entry, option),
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
