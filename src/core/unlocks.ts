import type { CommandResult } from "./commands";
import { compareKeys, sortedKeys } from "./data";
import type { Condition, Decree } from "./decree";
import { type AddContext, add } from "./math";
import { GameStateManager } from "./state";

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
export const PALETTE_UNLOCK: UnlockId = "control.palette";
export const SAVED_DECREES_UNLOCK: UnlockId = "control.savedDecrees";

export class UnlockManager {
  constructor(private manager: GameStateManager) {}

  enabled(id: UnlockId) {
    return Object.hasOwn(this.manager.state.career.unlocks, id);
  }

  get purchased(): UnlockId[] {
    return sortedKeys(this.manager.state.career.unlocks);
  }

  run(): void {
    const { play, needs } = this.manager.tuning.archive;
    const sortedPlay = [...play].sort((a, b) => compareKeys(a.id, b.id));
    for (const unlock of sortedPlay) {
      if (this.enabled(unlock.id)) continue;
      if (this.manager.cm.evaluate(unlock.when, {})) {
        this.manager.state.career.unlocks[unlock.id] = this.manager.state.tick;
      }
    }
    const sortedNeeds = [...needs].sort((a, b) =>
      compareKeys(a.control, b.control),
    );
    for (const hook of sortedNeeds) {
      if (Object.hasOwn(this.manager.state.career.needed, hook.control))
        continue;
      if (this.manager.cm.evaluate(hook.when, {})) {
        this.manager.state.career.needed[hook.control] =
          this.manager.state.tick;
      }
    }
  }

  buy(id: UnlockId, context: AddContext): void {
    const { entries, play } = this.manager.tuning.archive;
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
    const coin = this.manager.state.posting.resources.coin ?? 0;
    if (coin < entry.cost) {
      throw new Error(`you do not have enough coin to purchase ${entry.label}`);
    }
    add(this.manager.state.posting.resources, "coin", -entry.cost, context);
    this.manager.state.career.unlocks[id] = this.manager.state.tick;
  }

  /** The unlock a decree needs and does not have, or null. Used by enactDecree and, in step 3, saveDecree. */
  missingDecreeUnlock(decree: Decree): ArchiveEntry | null {
    const needs = (kinds: readonly string[], id: UnlockId) =>
      !this.enabled(id) &&
      decree.rules.some((rule) => usesKind(rule.when, kinds));
    const missing: UnlockId[] = [];
    if (needs(["all", "any", "not"], COMPOUND_UNLOCK)) {
      missing.push(COMPOUND_UNLOCK);
    }
    if (needs(["chose"], CHAINING_UNLOCK)) missing.push(CHAINING_UNLOCK);
    const id = missing[0];
    if (id === undefined) return null;
    const found = this.manager.tuning.archive.entries.find(
      (entry) => entry.id === id,
    );
    if (found === undefined)
      throw new Error(`archive entry "${id}" is missing`);
    return found;
  }
}

function usesKind(condition: Condition, kinds: readonly string[]): boolean {
  if (kinds.includes(condition.kind)) return true;
  switch (condition.kind) {
    case "all":
    case "any":
      return condition.conditions.some((child) => usesKind(child, kinds));
    case "not":
      return usesKind(condition.condition, kinds);
    default:
      return false;
  }
}

export function missingDecreeUnlockReason(entry: ArchiveEntry): string {
  return `this decree needs "${entry.label}" from the Archive`;
}
