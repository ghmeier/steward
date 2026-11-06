import type { CommandResult } from "./commands";
import { sortedKeys } from "./data";
import type { Game } from "./game";
import type { AddContext } from "./math";
import { add } from "./math";
import type { Resource } from "./realm";
import { drawDelay, intBelow, type RngState } from "./rng";
import type { DisputeOption, DisputeTemplate } from "./tuning";

export type Dispute = {
  id: number;
  template: string;
  parties: [number, number];
  arrivedAt: number;
};

/** Disputes are oldest first. */
export type DeskState = {
  nextDisputeId: number;
  nextArrivalTick: number;
  disputes: Dispute[];
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

  templateOf(dispute: Dispute): DisputeTemplate {
    const template = this.tuning.village.disputes.find(
      (candidate) => candidate.id === dispute.template,
    );
    if (template === undefined) {
      throw new Error(
        `dispute ${dispute.id} uses unknown template "${dispute.template}"; the village content changed under this save`,
      );
    }
    return template;
  }

  private optionOf(
    template: DisputeTemplate,
    optionId: string,
  ): DisputeOption | undefined {
    return template.options.find((option) => option.id === optionId);
  }

  /** Names the first resource the village cannot cover, or null when the option is affordable. */
  shortfall(option: DisputeOption): string | null {
    const resources = option.resources ?? {};
    for (const resource of sortedKeys(resources)) {
      const delta = resources[resource as Resource] ?? 0;
      const held = this.posting.resources[resource] ?? 0;
      if (held + delta < 0) {
        return `not enough ${resource} (need ${show(-delta)}, have ${show(held)})`;
      }
    }
    return null;
  }

  private applyResources(
    option: DisputeOption,
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

  settle(
    disputeId: number,
    optionId: string,
    context: AddContext,
  ): CommandResult {
    const disputes = this.posting.desk.disputes;
    const index = disputes.findIndex((candidate) => candidate.id === disputeId);
    const dispute = disputes[index];
    if (dispute === undefined) {
      return { ok: false, reason: `no dispute ${disputeId}` };
    }
    const template = this.templateOf(dispute);
    const option = this.optionOf(template, optionId);
    if (option === undefined) {
      return {
        ok: false,
        reason: `dispute ${disputeId} has no option "${optionId}"`,
      };
    }
    const problem = this.shortfall(option);
    if (problem !== null) return { ok: false, reason: problem };

    this.applyResources(option, context, false);
    if (option.grudge !== undefined) {
      const party = dispute.parties[option.grudge === "first" ? 0 : 1];
      const peasant = this.game.delegates.findById(party);
      if (peasant !== undefined) {
        peasant.grudgeUntil = Math.max(
          peasant.grudgeUntil,
          this.state.tick + this.tuning.village.grudgeTicks,
        );
      }
    }
    disputes.splice(index, 1);
    return { ok: true };
  }

  private drawDispute(): void {
    const { desk, delegates } = this.posting;
    const stream = this.stream;
    const templates = this.tuning.village.disputes;
    const template = templates[intBelow(stream, templates.length)];
    const firstIndex = intBelow(stream, delegates.length);
    const drawn = intBelow(stream, delegates.length - 1);
    const secondIndex = drawn >= firstIndex ? drawn + 1 : drawn;
    const first = delegates[firstIndex];
    const second = delegates[secondIndex];
    if (template === undefined || first === undefined || second === undefined) {
      throw new Error("dispute draw landed outside its range");
    }
    desk.disputes.push({
      id: desk.nextDisputeId,
      template: template.id,
      parties: [first.id, second.id],
      arrivedAt: this.state.tick,
    });
    desk.nextDisputeId += 1;
  }

  run(context: AddContext): void {
    const { desk, delegates } = this.posting;
    for (const dispute of desk.disputes) this.templateOf(dispute);

    const living = new Set(delegates.map((delegate) => delegate.id));
    desk.disputes = desk.disputes.filter((dispute) =>
      dispute.parties.every((party) => living.has(party)),
    );

    if (this.state.tick >= desk.nextArrivalTick) {
      if (delegates.length >= 2) this.drawDispute();
      desk.nextArrivalTick =
        this.state.tick +
        drawDelay(this.stream, this.tuning.village.disputeArrival);
    }

    while (desk.disputes.length > this.tuning.village.deskSlots) {
      const oldest = desk.disputes.shift();
      if (oldest === undefined) break;
      const template = this.templateOf(oldest);
      const option = this.optionOf(template, template.expiry);
      if (option === undefined) throw new Error("expiry option is missing");
      this.applyResources(option, context, true);
    }
  }
}
