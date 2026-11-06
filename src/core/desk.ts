import type { CommandResult } from "./commands";
import { sortedKeys } from "./data";
import type { Game } from "./game";
import type { AddContext } from "./math";
import { add } from "./math";
import { DESK_KINDS, type DeskKind, type Resource } from "./realm";
import { drawDelay, intBelow, type RngState } from "./rng";
import type { DeskOption, DeskTemplate } from "./tuning";

type EntryBase = {
  id: number;
  template: string;
  arrivedAt: number;
};

export type Dispute = EntryBase & {
  kind: "dispute";
  parties: [number, number];
};

/** An entry with no parties: a merchant or a traveller. */
export type Offer = EntryBase & { kind: "merchant" | "traveller" };

export type DeskEntry = Dispute | Offer;

/** The id is 0 until something has expired, since entry ids start at 1. */
export type Expiry = { id: number; line: string };

export const NO_EXPIRY: Expiry = { id: 0, line: "" };

/** Entries are oldest first. The field names predate the other kinds and are kept so saves and the command log stay valid. */
export type DeskState = {
  nextDisputeId: number;
  nextArrivalTick: number;
  disputes: DeskEntry[];
  lastExpired: Expiry;
};

export function fillNames(text: string, first: string, second: string): string {
  return text.replaceAll("{first}", first).replaceAll("{second}", second);
}

// Floored so a village holding 4.96 against a need of 5 is never described as having 5.
function show(amount: number): string {
  return String(Math.floor(amount * 10) / 10);
}

export class DeskManager {
  constructor(private game: Game) {}

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

  private get hasRoom(): boolean {
    return this.posting.delegates.length < this.tuning.economy.maxPopulation;
  }

  private nameOf(id: number): string {
    const peasant = this.game.delegates.findById(id);
    if (peasant === undefined) {
      throw new Error(`dispute party ${id} is not in the roster`);
    }
    return peasant.name;
  }

  partyNames(entry: DeskEntry): [string, string] | null {
    if (entry.kind !== "dispute") return null;
    const [first, second] = entry.parties;
    return [this.nameOf(first), this.nameOf(second)];
  }

  /** Fills a template's placeholders with the names of the entry's parties; other kinds have none. */
  fill(entry: DeskEntry, text: string): string {
    const names = this.partyNames(entry);
    return names === null ? text : fillNames(text, names[0], names[1]);
  }

  /** Names the first thing the village cannot cover, or null when the option is affordable. */
  shortfall(option: DeskOption): string | null {
    const resources = option.resources ?? {};
    for (const resource of sortedKeys(resources)) {
      const delta = resources[resource as Resource] ?? 0;
      const held = this.posting.resources[resource] ?? 0;
      if (held + delta < 0) {
        return `not enough ${resource} (need ${show(-delta)}, have ${show(held)})`;
      }
    }
    if (option.newcomer !== undefined && !this.hasRoom) {
      return "the village has no room for another peasant";
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
        delta = Math.max(delta, -(this.posting.resources[resource] ?? 0));
      }
      add(this.posting.resources, resource, delta, context);
    }
  }

  private applyGrudge(entry: DeskEntry, option: DeskOption): void {
    if (option.grudge === undefined || entry.kind !== "dispute") return;
    const party = entry.parties[option.grudge === "first" ? 0 : 1];
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
      return { ok: false, reason: `no dispute ${entryId}` };
    }
    const template = this.templateOf(entry);
    const option = this.optionOf(template, optionId);
    if (option === undefined) {
      return {
        ok: false,
        reason: `dispute ${entryId} has no option "${optionId}"`,
      };
    }
    const problem = this.shortfall(option);
    if (problem !== null) return { ok: false, reason: problem };

    this.applyResources(option, context, false);
    this.applyGrudge(entry, option);
    if (option.newcomer !== undefined) this.game.economy.admitNewcomer();
    entries.splice(index, 1);
    return { ok: true };
  }

  private isEligible(kind: DeskKind): boolean {
    switch (kind) {
      case "dispute":
        return this.posting.delegates.length >= 2;
      case "traveller":
        return this.hasRoom;
      case "merchant":
        return true;
    }
  }

  private drawKind(): DeskKind {
    const eligible = DESK_KINDS.filter((kind) => this.isEligible(kind));
    const weight = (kind: DeskKind) => this.tuning.desk.kinds[kind].weight;
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

  private expire(entry: DeskEntry, context: AddContext): void {
    const template = this.templateOf(entry);
    const option = this.optionOf(template, template.expiry);
    if (option === undefined) throw new Error("expiry option is missing");
    this.applyResources(option, context, true);
    this.posting.desk.lastExpired = {
      id: entry.id,
      line: this.fill(entry, template.expired),
    };
  }

  // Only a dispute depends on a peasant, so only a dispute can go stale.
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
    for (const entry of desk.disputes) this.templateOf(entry);
    this.dropStaleDisputes();

    if (this.state.tick >= desk.nextArrivalTick) {
      this.arrive();
      desk.nextArrivalTick =
        this.state.tick + drawDelay(this.stream, this.tuning.desk.arrival);
    }

    while (desk.disputes.length > this.tuning.desk.slots) {
      const oldest = desk.disputes.shift();
      if (oldest === undefined) break;
      this.expire(oldest, context);
    }
  }
}
