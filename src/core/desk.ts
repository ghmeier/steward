import type { CommandResult } from "./commands";
import { copy } from "./copy";
import { sortedKeys } from "./data";
import type { Game } from "./game";
import type { AddContext } from "./math";
import { add } from "./math";
import type { Resource } from "./realm";
import { drawDelay, intBelow, type RngState } from "./rng";
import type { DeskOption, DeskTemplate } from "./tuning";

/** A record keyed by kind is in this order, so the weighted draw walks the kinds in a fixed order. */
export const DRAWN_KINDS = ["dispute", "merchant", "traveller"] as const;
export type DrawnKind = (typeof DRAWN_KINDS)[number];

/** Audits are placed by the illusion manager rather than drawn, so they are not among the drawn kinds. */
export type DeskKind = DrawnKind | "audit";

type EntryBase = {
  id: number;
  template: string;
  arrivedAt: number;
};

export type Dispute = EntryBase & {
  kind: "dispute";
  parties: [number, number];
};

export type Offer = EntryBase & { kind: Exclude<DrawnKind, "dispute"> };

export type Audit = EntryBase & { kind: "audit"; dueAt: number };

export type DeskEntry = Dispute | Offer | Audit;

/** Entries of every kind, oldest first; the field names predate the kinds other than disputes. */
export type DeskState = {
  nextDisputeId: number;
  nextArrivalTick: number;
  disputes: DeskEntry[];
};

// Floored so a village holding 4.96 against a need of 5 is never described as having 5.
function show(amount: number): string {
  return String(Math.floor(amount * 10) / 10);
}

export class DeskManager {
  // Not saved: the lines only feed the TUI's notice, which reads them after each step.
  private expiredThisStep: string[] = [];

  constructor(private game: Game) {}

  /** The flavor lines of the entries that expired during the latest step. */
  get expired(): readonly string[] {
    return this.expiredThisStep;
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

  /** Fills a template's placeholders with the names of the entry's parties; other kinds have none. */
  fill(entry: DeskEntry, text: string): string {
    if (entry.kind !== "dispute") return text;
    const [first, second] = entry.parties;
    return text
      .replaceAll("{first}", this.nameOf(first))
      .replaceAll("{second}", this.nameOf(second));
  }

  /** What choosing the option adds and removes; an audit's is worked out from the books, not the template. */
  deltasOf(entry: DeskEntry, option: DeskOption): Record<string, number> {
    return entry.kind === "audit"
      ? this.game.illusion.auditCost(option.id)
      : (option.resources ?? {});
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
    return null;
  }

  private applyResources(
    option: DeskOption,
    context: AddContext,
    clampLosses: boolean,
  ): void {
    const resources = option.resources ?? {};
    for (const resource of sortedKeys(resources)) {
      let delta = resources[resource as Resource] ?? 0;
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
    if (option.grudge === undefined || entry.kind !== "dispute") return null;
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
    } else {
      this.applyResources(option, context, false);
    }
    this.applyGrudge(entry, option);
    if (option.newcomer !== undefined) this.game.economy.admitNewcomer();
    entries.splice(index, 1);
    return { ok: true };
  }

  private isEligible(kind: DrawnKind): boolean {
    switch (kind) {
      case "dispute":
        return this.posting.delegates.length >= 2;
      case "traveller":
        return this.game.economy.hasRoom;
      case "merchant":
        return true;
    }
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

  private drawParties(): [number, number] {
    const { delegates } = this.posting;
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
    desk.disputes.push(
      kind === "dispute"
        ? { ...base, kind, parties: this.drawParties() }
        : { ...base, kind },
    );
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
      this.applyResources(option, context, true);
    }
    this.expiredThisStep.push(this.fill(entry, template.expired));
  }

  private dropStaleDisputes(): void {
    const { desk, delegates } = this.posting;
    const living = new Set(delegates.map((delegate) => delegate.id));
    desk.disputes = desk.disputes.filter(
      (entry) =>
        entry.kind !== "dispute" ||
        entry.parties.every((party) => living.has(party)),
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
