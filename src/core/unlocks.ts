import { compareKeys, sortedKeys } from "./data";
import type { Condition, Decree, Quantity } from "./decree";
import type { Game } from "./game";
import { type AddContext, add } from "./math";

export type UnlockId = string;
export type ArchiveEntry = {
  id: UnlockId;
  label: string;
  description: string;
  cost: number;
  requires: UnlockId[];
};
export type PlayUnlock = { id: UnlockId; label: string; when: Condition };
export type NeedHook = { control: string; when: Condition };
export type ArchiveTuning = {
  maxSaved: number;
  entries: ArchiveEntry[];
  play: PlayUnlock[];
  needs: NeedHook[];
};

export const ARCHIVE_PANEL: UnlockId = "panel.archive";
export const CROWN_PANEL: UnlockId = "panel.crown";
export const COMPOUND_UNLOCK: UnlockId = "decree.compound";
export const CHAINING_UNLOCK: UnlockId = "decree.chaining";
export const CROWN_CORRESPONDENCE: UnlockId = "decree.crownCorrespondence";
export const PALETTE_UNLOCK: UnlockId = "control.palette";
export const SAVED_DECREES_UNLOCK: UnlockId = "control.savedDecrees";

export class UnlockManager {
  constructor(private game: Game) {}

  enabled(id: UnlockId) {
    return Object.hasOwn(this.game.state.career.unlocks, id);
  }

  get purchased(): UnlockId[] {
    return sortedKeys(this.game.state.career.unlocks);
  }

  run(): void {
    const { play, needs } = this.game.tuning.archive;
    const sortedPlay = [...play].sort((a, b) => compareKeys(a.id, b.id));
    for (const unlock of sortedPlay) {
      if (this.enabled(unlock.id)) continue;
      if (this.game.conditions.evaluate(unlock.when, {})) {
        this.game.state.career.unlocks[unlock.id] = this.game.state.tick;
      }
    }
    const sortedNeeds = [...needs].sort((a, b) =>
      compareKeys(a.control, b.control),
    );
    for (const hook of sortedNeeds) {
      if (Object.hasOwn(this.game.state.career.needed, hook.control)) continue;
      if (this.game.conditions.evaluate(hook.when, {})) {
        this.game.state.career.needed[hook.control] = this.game.state.tick;
      }
    }
  }

  buy(id: UnlockId, context: AddContext): void {
    const { entries, play } = this.game.tuning.archive;
    if (play.some((unlock) => unlock.id === id)) {
      throw new Error(`"${id}" is not purchasable`);
    }
    const entry = entries.find((candidate) => candidate.id === id);
    if (entry === undefined) {
      throw new Error(`the Archive does not sell "${id}"`);
    }
    if (this.enabled(id)) {
      throw new Error(`you already own ${entry.label}`);
    }
    if (!this.enabled(ARCHIVE_PANEL)) {
      throw new Error("the Archive is not open");
    }
    for (const required of entry.requires) {
      if (!this.enabled(required)) {
        const label =
          entries.find((candidate) => candidate.id === required)?.label ??
          required;
        throw new Error(`${entry.label} needs ${label} first`);
      }
    }
    const coin = this.game.state.posting.resources.coin ?? 0;
    if (coin < entry.cost) {
      throw new Error(`you do not have enough coin to purchase ${entry.label}`);
    }
    add(this.game.state.posting.resources, "coin", -entry.cost, context);
    this.game.state.career.unlocks[id] = this.game.state.tick;
  }

  /** The Archive entry a decree needs and the player has not bought, or null. */
  missingDecreeUnlock(decree: Decree): ArchiveEntry | null {
    const needs = (matches: (node: Condition) => boolean, id: UnlockId) =>
      !this.enabled(id) &&
      decree.rules.some((rule) => someNode(rule.when, matches));
    const missing: UnlockId[] = [];
    if (
      needs(
        (node) => ["all", "any", "not"].includes(node.kind),
        COMPOUND_UNLOCK,
      )
    ) {
      missing.push(COMPOUND_UNLOCK);
    }
    if (needs((node) => node.kind === "chose", CHAINING_UNLOCK)) {
      missing.push(CHAINING_UNLOCK);
    }
    if (needs(readsOwedQuantity, CROWN_CORRESPONDENCE)) {
      missing.push(CROWN_CORRESPONDENCE);
    }
    const id = missing[0];
    if (id === undefined) return null;
    const found = this.game.tuning.archive.entries.find(
      (entry) => entry.id === id,
    );
    if (found === undefined)
      throw new Error(`archive entry "${id}" is missing`);
    return found;
  }
}

const OWED_QUANTITIES: readonly Quantity[] = [
  "owedCoin",
  "owedGrain",
  "owedOre",
  "owedWood",
];

function readsOwedQuantity(node: Condition): boolean {
  return node.kind === "compare" && OWED_QUANTITIES.includes(node.quantity);
}

function someNode(
  condition: Condition,
  matches: (node: Condition) => boolean,
): boolean {
  if (matches(condition)) return true;
  switch (condition.kind) {
    case "all":
    case "any":
      return condition.conditions.some((child) => someNode(child, matches));
    case "not":
      return someNode(condition.condition, matches);
    default:
      return false;
  }
}

export function missingDecreeUnlockReason(entry: ArchiveEntry): string {
  return `this decree needs "${entry.label}" from the Archive`;
}
