import { z } from "zod";
import type { CommandResult } from "./commands";
import { copy } from "./copy";
import { sortedKeys } from "./data";
import type { DeskOption, DeskTemplate, DeskTuning } from "./desk-tuning";
import type { Game } from "./game";
import type { CandidateDetails } from "./governors";
import type { AddContext } from "./math";
import { add } from "./math";
import { WORKING_JOBS } from "./realm";
import { drawDelay, intBelow, type RngState } from "./rng";
import {
  ascendingIdIssues,
  count,
  positive,
  positiveCount,
  traitList,
} from "./schema";

/** A record keyed by kind is in this order, so the weighted draw walks the kinds in a fixed order. */
export const DRAWN_KINDS = [
  "candidate",
  "dispute",
  "merchant",
  "omen",
  "petition",
  "traveller",
] as const;
export type DrawnKind = (typeof DRAWN_KINDS)[number];

/** Audits are placed by the illusion manager rather than drawn, so they are not among the drawn kinds. */
export const DESK_KINDS = [...DRAWN_KINDS, "audit"] as const;
export type DeskKind = (typeof DESK_KINDS)[number];

type EntryBase = {
  id: number;
  template: string;
  arrivedAt: number;
};

/** Option amounts are multiplied by this when the entry arrives, and it is kept so the numbers shown stay the numbers applied. */
type Scaled = { scale?: number };

export type Dispute = EntryBase &
  Scaled & {
    kind: "dispute";
    parties: [number, number];
  };

/** A peasant asking the steward for something; refusing is what makes them sulk. */
export type Petition = EntryBase &
  Scaled & { kind: "petition"; peasant: number };

export type Offer = EntryBase &
  Scaled & {
    kind: "merchant" | "omen" | "traveller";
    /** How many peasants a traveller's admitting option brings; absent means one. */
    newcomers?: number;
  };

/** A governor asking to be hired; what they offer is stored here so it survives a save. */
export type Candidate = EntryBase & { kind: "candidate" } & CandidateDetails;

export type Audit = EntryBase & { kind: "audit"; dueAt: number };

export type DeskEntry = Dispute | Petition | Offer | Candidate | Audit;

/** The option that hires a candidate; the template schema requires it. */
export const HIRE = "hire";

/** Entries of every kind, oldest first; the field names predate the kinds other than disputes. */
export type DeskState = {
  nextDisputeId: number;
  nextArrivalTick: number;
  disputes: DeskEntry[];
};

const deskEntryBase = {
  id: positiveCount,
  template: z.string().min(1),
  arrivedAt: count,
};

const deskEntry = z.discriminatedUnion("kind", [
  z.strictObject({
    ...deskEntryBase,
    kind: z.literal("dispute"),
    parties: z.tuple([positiveCount, positiveCount]),
    scale: positive.exactOptional(),
  }),
  z.strictObject({
    ...deskEntryBase,
    kind: z.literal("petition"),
    peasant: positiveCount,
    scale: positive.exactOptional(),
  }),
  z.strictObject({
    ...deskEntryBase,
    kind: z.enum(DRAWN_KINDS).exclude(["dispute", "candidate", "petition"]),
    scale: positive.exactOptional(),
    newcomers: positiveCount.exactOptional(),
  }),
  z.strictObject({
    ...deskEntryBase,
    kind: z.literal("candidate"),
    name: z.string().min(1),
    job: z.enum(WORKING_JOBS),
    village: positiveCount,
    traits: traitList,
    price: count,
    term: positiveCount,
  }),
  z.strictObject({ ...deskEntryBase, kind: z.literal("audit"), dueAt: count }),
]);

export const deskStateSchema: z.ZodType<DeskState> = z
  .strictObject({
    nextDisputeId: positiveCount,
    nextArrivalTick: count,
    disputes: z.array(deskEntry),
  })
  .superRefine((value, ctx) =>
    ascendingIdIssues(ctx, value, "disputes", "nextDisputeId"),
  );

/** Draws the first arrival from the disputes stream, so a new game's desk starts on the same schedule as every later one. */
export function initialDeskState(
  arrivals: RngState,
  tuning: DeskTuning,
): DeskState {
  return {
    nextDisputeId: 1,
    nextArrivalTick: drawDelay(arrivals, tuning.arrival),
    disputes: [],
  };
}

// Floored so a village holding 4.96 against a need of 5 is never described as having 5.
function show(amount: number): string {
  return String(Math.floor(amount * 10) / 10);
}

export type DeskOptionView = {
  id: string;
  label: string;
  affordable: boolean;
  expiry: boolean;
  /** Resource deltas, keys sorted. */
  resources: Record<string, number>;
  /** How many peasants choosing the option adds; zero when it adds none. */
  newcomers: number;
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

export class DeskManager {
  // Not saved: the lines only feed the TUI's notice, which reads them after each step.
  private expiredThisStep: string[] = [];

  constructor(private game: Game) {}

  /** The flavor lines of the entries that expired during the latest step. */
  get expired(): readonly string[] {
    return this.expiredThisStep;
  }

  /** Candidates waiting on the desk, whose names are taken even though they are not on the roster. */
  get candidates(): Candidate[] {
    return this.posting.desk.disputes.filter(
      (entry) => entry.kind === "candidate",
    );
  }

  private get state() {
    return this.game.state;
  }

  private get posting() {
    return this.state.posting;
  }

  private get tuning() {
    return this.game.tuning;
  }

  private get stream(): RngState {
    const stream = this.posting.rng.disputes;
    if (stream === undefined) throw new Error("the disputes stream is missing");
    return stream;
  }

  view(): DeskEntryView[] {
    return this.posting.desk.disputes.map((entry) => {
      const template = this.templateOf(entry);
      return {
        id: entry.id,
        kind: entry.kind,
        label: this.fill(entry, template.text),
        ticksLeft:
          entry.kind === "audit" ? entry.dueAt - this.state.tick : null,
        options: template.options.map((option) => ({
          id: option.id,
          label: this.fill(entry, option.label),
          affordable: this.shortfall(entry, option) === null,
          expiry: option.id === template.expiry,
          resources: this.sortedDeltas(entry, option),
          newcomers:
            option.newcomer === undefined ? 0 : this.newcomersOf(entry),
          sulker: this.sulker(entry, option),
        })),
      };
    });
  }

  private sortedDeltas(entry: DeskEntry, option: DeskOption) {
    const deltas = this.deltasOf(entry, option);
    const sorted: Record<string, number> = {};
    for (const key of sortedKeys(deltas)) sorted[key] = deltas[key] ?? 0;
    return sorted;
  }

  templatesOf(kind: DeskKind): readonly DeskTemplate[] {
    return this.tuning.desk.kinds[kind].templates;
  }

  templateOf(entry: DeskEntry): DeskTemplate {
    const template = this.templatesOf(entry.kind).find(
      (candidate) => candidate.id === entry.template,
    );
    if (template === undefined) {
      throw new Error(
        `desk entry ${entry.id} uses unknown ${entry.kind} template "${entry.template}"; the desk content changed under this save`,
      );
    }
    return template;
  }

  private optionOf(
    template: DeskTemplate,
    optionId: string,
  ): DeskOption | undefined {
    return template.options.find((option) => option.id === optionId);
  }

  private nameOf(id: number): string {
    const peasant = this.game.delegates.findById(id);
    if (peasant === undefined) {
      throw new Error(`dispute party ${id} is not in the roster`);
    }
    return peasant.name;
  }

  /** Fills a template's placeholders from the entry: the parties of a dispute or the details of a candidate. */
  fill(entry: DeskEntry, text: string): string {
    if (entry.kind === "candidate") {
      return text
        .replaceAll("{name}", entry.name)
        .replaceAll("{village}", String(entry.village))
        .replaceAll("{price}", String(entry.price))
        .replaceAll("{job}", copy.governors.jobWords[entry.job])
        .replaceAll(
          "{traits}",
          copy.governors.traitList({ traits: entry.traits }),
        );
    }
    if (entry.kind === "petition") {
      return text.replaceAll("{first}", this.nameOf(entry.peasant));
    }
    if (entry.kind !== "dispute") return text;
    const [first, second] = entry.parties;
    return text
      .replaceAll("{first}", this.nameOf(first))
      .replaceAll("{second}", this.nameOf(second));
  }

  /** What choosing the option adds and removes; an audit's is worked out from the books and a hire's from the entry, not the template. */
  deltasOf(entry: DeskEntry, option: DeskOption): Record<string, number> {
    if (entry.kind === "audit") return this.game.illusion.auditCost(option.id);
    if (entry.kind === "candidate") {
      return option.id === HIRE ? { coin: -entry.price } : {};
    }
    const scale = entry.scale ?? 1;
    const scaled: Record<string, number> = {};
    for (const [resource, amount] of Object.entries(option.resources ?? {})) {
      scaled[resource] = Math.round(amount * scale);
    }
    return scaled;
  }

  private newcomersOf(entry: DeskEntry): number {
    return entry.kind === "traveller" ? (entry.newcomers ?? 1) : 1;
  }

  private admitNewcomers(entry: DeskEntry): void {
    for (let i = 0; i < this.newcomersOf(entry); i++) {
      if (!this.game.economy.hasRoom) return;
      this.game.economy.admitNewcomer();
    }
  }

  get hasAudit(): boolean {
    return this.posting.desk.disputes.some((entry) => entry.kind === "audit");
  }

  removeAudit(): void {
    this.posting.desk.disputes = this.posting.desk.disputes.filter(
      (entry) => entry.kind !== "audit",
    );
  }

  /** Names the first thing the village cannot cover, or null when the option is affordable. */
  shortfall(entry: DeskEntry, option: DeskOption): string | null {
    // Auditors accept only real stock, so apparent stock does not count for them.
    const isAudit = entry.kind === "audit";
    const deltas = this.deltasOf(entry, option);
    for (const resource of sortedKeys(deltas)) {
      const delta = deltas[resource] ?? 0;
      const held = isAudit
        ? (this.posting.resources[resource] ?? 0)
        : this.game.illusion.apparent(resource);
      if (held + delta < 0) {
        return (isAudit ? copy.desk.notEnoughReal : copy.desk.notEnough)({
          resource,
          need: show(-delta),
          have: show(held),
        });
      }
    }
    if (option.newcomer !== undefined && !this.game.economy.hasRoom) {
      return copy.desk.noRoomForPeasant;
    }
    if (entry.kind === "candidate" && option.id === HIRE) {
      if (!this.game.governors.hasRoom) return copy.governors.noRoomForGovernor;
    }
    return null;
  }

  private applyResources(
    entry: DeskEntry,
    option: DeskOption,
    context: AddContext,
    clampLosses: boolean,
  ): void {
    const resources = this.deltasOf(entry, option);
    for (const resource of sortedKeys(resources)) {
      let delta = resources[resource] ?? 0;
      if (clampLosses) {
        delta = Math.max(delta, -this.game.illusion.apparent(resource));
      }
      if (delta < 0) {
        this.game.illusion.spend(resource, -delta, context);
      } else {
        add(this.posting.resources, resource, delta, context);
      }
    }
  }

  private grudgedParty(entry: DeskEntry, option: DeskOption): number | null {
    if (option.grudge === undefined) return null;
    if (entry.kind === "petition") return entry.peasant;
    if (entry.kind !== "dispute") return null;
    return entry.parties[option.grudge === "first" ? 0 : 1];
  }

  sulker(entry: DeskEntry, option: DeskOption): string | null {
    const party = this.grudgedParty(entry, option);
    return party === null ? null : this.nameOf(party);
  }

  private applyGrudge(entry: DeskEntry, option: DeskOption): void {
    const party = this.grudgedParty(entry, option);
    if (party === null) return;
    const peasant = this.game.delegates.findById(party);
    if (peasant !== undefined) {
      peasant.grudgeUntil = Math.max(
        peasant.grudgeUntil,
        this.state.tick + this.tuning.desk.grudgeTicks,
      );
    }
  }

  /**
   * Answers the oldest waiting entry of a kind, for callers such as strategies that cannot know an
   * entry's id. Entries are stored oldest first.
   */
  settleOldest(
    kind: DeskKind,
    optionId: string,
    context: AddContext,
  ): CommandResult {
    const oldest = this.posting.desk.disputes.find(
      (entry) => entry.kind === kind,
    );
    if (oldest === undefined) {
      return { ok: false, reason: copy.desk.noEntryOfKind({ kind }) };
    }
    return this.settle(oldest.id, optionId, context);
  }

  settle(
    entryId: number,
    optionId: string,
    context: AddContext,
  ): CommandResult {
    const entries = this.posting.desk.disputes;
    const index = entries.findIndex((candidate) => candidate.id === entryId);
    const entry = entries[index];
    if (entry === undefined) {
      return { ok: false, reason: copy.desk.noDispute({ entryId }) };
    }
    const template = this.templateOf(entry);
    const option = this.optionOf(template, optionId);
    if (option === undefined) {
      return {
        ok: false,
        reason: copy.desk.noSuchOption({
          entryId,
          optionId,
        }),
      };
    }
    const problem = this.shortfall(entry, option);
    if (problem !== null) return { ok: false, reason: problem };

    if (entry.kind === "audit") {
      this.game.illusion.settleAudit(option.id, context);
    } else if (entry.kind === "candidate") {
      if (option.id === HIRE) this.game.governors.hire(entry, context);
    } else {
      this.applyResources(entry, option, context, false);
    }
    this.applyGrudge(entry, option);
    if (option.newcomer !== undefined) this.admitNewcomers(entry);
    entries.splice(index, 1);
    return { ok: true };
  }

  private isEligible(kind: DrawnKind): boolean {
    const { unlock } = this.tuning.desk.kinds[kind];
    if (unlock !== undefined && !this.game.unlocks.enabled(unlock)) {
      return false;
    }
    switch (kind) {
      case "candidate":
        return this.game.governors.canOffer;
      case "dispute":
        return this.game.delegates.peasants.length >= 2;
      case "traveller":
        return this.game.economy.hasRoom;
      case "petition":
        return this.game.delegates.peasants.length >= 1;
      case "merchant":
      case "omen":
        return true;
    }
  }

  /** Grows with the realm so a reward or a price keeps pace with what the village earns; never below the written amount. */
  private get scale(): number {
    const { perPopulation } = this.tuning.desk.scale;
    return Math.max(1, this.game.delegates.population / perPopulation);
  }

  private drawKind(): DrawnKind {
    const eligible = DRAWN_KINDS.filter((kind) => this.isEligible(kind));
    const weight = (kind: DrawnKind) => this.tuning.desk.kinds[kind].weight;
    let roll = intBelow(
      this.stream,
      eligible.reduce((total, kind) => total + weight(kind), 0),
    );
    for (const kind of eligible) {
      roll -= weight(kind);
      if (roll < 0) return kind;
    }
    throw new Error("desk kind draw landed outside its range");
  }

  private drawPeasant(): number {
    const peasants = this.game.delegates.peasants;
    const drawn = peasants[intBelow(this.stream, peasants.length)];
    if (drawn === undefined) {
      throw new Error("petitioner draw landed outside its range");
    }
    return drawn.id;
  }

  private drawParties(): [number, number] {
    const delegates = this.game.delegates.peasants;
    const firstIndex = intBelow(this.stream, delegates.length);
    const drawn = intBelow(this.stream, delegates.length - 1);
    const secondIndex = drawn >= firstIndex ? drawn + 1 : drawn;
    const first = delegates[firstIndex];
    const second = delegates[secondIndex];
    if (first === undefined || second === undefined) {
      throw new Error("dispute party draw landed outside its range");
    }
    return [first.id, second.id];
  }

  private arrive(): void {
    const { desk } = this.posting;
    const kind = this.drawKind();
    const templates = this.templatesOf(kind);
    const template = templates[intBelow(this.stream, templates.length)];
    if (template === undefined) {
      throw new Error("desk template draw landed outside its range");
    }
    const base = {
      id: desk.nextDisputeId,
      template: template.id,
      arrivedAt: this.state.tick,
    };
    const scaled = { ...base, scale: this.scale };
    switch (kind) {
      case "dispute":
        desk.disputes.push({ ...scaled, kind, parties: this.drawParties() });
        break;
      case "petition":
        desk.disputes.push({ ...scaled, kind, peasant: this.drawPeasant() });
        break;
      case "candidate":
        desk.disputes.push({
          ...base,
          kind,
          ...this.game.governors.drawCandidate(),
        });
        break;
      case "merchant":
      case "omen":
        desk.disputes.push({ ...scaled, kind });
        break;
      case "traveller":
        desk.disputes.push({
          ...scaled,
          kind,
          newcomers: Math.ceil(
            this.game.delegates.population /
              this.tuning.desk.scale.newcomersPer,
          ),
        });
        break;
    }
    desk.nextDisputeId += 1;
  }

  /**
   * Places the auditors on the desk. The template is picked from the entry id rather than drawn, so
   * an audit consumes nothing from the desk's random stream and never shifts the arrivals after it.
   */
  placeAudit(dueAt: number): void {
    const { desk } = this.posting;
    const templates = this.templatesOf("audit");
    const template = templates[desk.nextDisputeId % templates.length];
    if (template === undefined) {
      throw new Error("audit template pick landed outside its range");
    }
    desk.disputes.push({
      id: desk.nextDisputeId,
      template: template.id,
      arrivedAt: this.state.tick,
      kind: "audit",
      dueAt,
    });
    desk.nextDisputeId += 1;
  }

  private expire(entry: DeskEntry, context: AddContext): void {
    const template = this.templateOf(entry);
    if (entry.kind === "audit") {
      this.game.illusion.failAudit(context);
    } else {
      const option = this.optionOf(template, template.expiry ?? "");
      if (option === undefined) throw new Error("expiry option is missing");
      this.applyResources(entry, option, context, true);
    }
    this.expiredThisStep.push(this.fill(entry, template.expired));
  }

  private dropStaleDisputes(): void {
    const { desk, delegates } = this.posting;
    const living = new Set(delegates.map((delegate) => delegate.id));
    desk.disputes = desk.disputes.filter(
      (entry) =>
        (entry.kind !== "dispute" ||
          entry.parties.every((party) => living.has(party))) &&
        (entry.kind !== "petition" || living.has(entry.peasant)),
    );
  }

  run(context: AddContext): void {
    const { desk } = this.posting;
    this.expiredThisStep = [];
    for (const entry of desk.disputes) this.templateOf(entry);
    this.dropStaleDisputes();

    if (this.state.tick >= desk.nextArrivalTick) {
      this.arrive();
      desk.nextArrivalTick =
        this.state.tick + drawDelay(this.stream, this.tuning.desk.arrival);
    }

    // An audit whose debt was repaid is passed by the illusion manager later in this step, so it must not lapse first.
    const lapsed = desk.disputes.filter(
      (entry) =>
        entry.kind === "audit" &&
        this.state.tick >= entry.dueAt &&
        this.game.illusion.hasDebt,
    );
    desk.disputes = desk.disputes.filter((entry) => !lapsed.includes(entry));
    for (const entry of lapsed) this.expire(entry, context);

    // Auditors wait out their own deadline, so overflow pushes out the oldest entry that is not one.
    while (desk.disputes.length > this.tuning.desk.slots) {
      const index = desk.disputes.findIndex((entry) => entry.kind !== "audit");
      if (index < 0) break;
      const [oldest] = desk.disputes.splice(index, 1);
      if (oldest === undefined) break;
      this.expire(oldest, context);
    }
  }
}
