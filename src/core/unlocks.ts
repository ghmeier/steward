import type { CommandResult } from "./commands";
import { evaluateCondition } from "./conditions";
import { compareKeys, sortedKeys } from "./data";
import type { Condition, Decree } from "./decree";
import { type AddContext, add } from "./math";
import type { GameState } from "./state";
import type { Tuning } from "./tuning";

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

export function hasUnlock(state: GameState, id: UnlockId): boolean {
  return Object.hasOwn(state.career.unlocks, id);
}

/** Records play unlocks and first-needed ticks whose condition first holds this step, in sorted id order. */
export function runUnlocks(state: GameState, tuning: Tuning): void {
  const { play, needs } = tuning.archive;
  const sortedPlay = [...play].sort((a, b) => compareKeys(a.id, b.id));
  for (const unlock of sortedPlay) {
    if (hasUnlock(state, unlock.id)) continue;
    if (evaluateCondition(unlock.when, state, tuning, {})) {
      state.career.unlocks[unlock.id] = state.tick;
    }
  }
  const sortedNeeds = [...needs].sort((a, b) =>
    compareKeys(a.control, b.control),
  );
  for (const hook of sortedNeeds) {
    if (Object.hasOwn(state.career.needed, hook.control)) continue;
    if (evaluateCondition(hook.when, state, tuning, {})) {
      state.career.needed[hook.control] = state.tick;
    }
  }
}

export function buyUnlock(
  state: GameState,
  id: UnlockId,
  tuning: Tuning,
  context: AddContext,
): CommandResult {
  const { entries, play } = tuning.archive;
  if (play.some((unlock) => unlock.id === id)) {
    return { ok: false, reason: `"${id}" cannot be bought, only earned` };
  }
  const entry = entries.find((candidate) => candidate.id === id);
  if (entry === undefined) {
    return { ok: false, reason: `the Archive does not sell "${id}"` };
  }
  if (hasUnlock(state, id)) {
    return { ok: false, reason: `${entry.label} is already owned` };
  }
  if (!hasUnlock(state, ARCHIVE_PANEL)) {
    return { ok: false, reason: "the Archive is not open" };
  }
  for (const required of entry.requires) {
    if (!hasUnlock(state, required)) {
      const label =
        entries.find((candidate) => candidate.id === required)?.label ??
        required;
      return { ok: false, reason: `${entry.label} needs ${label} first` };
    }
  }
  const coin = state.posting.resources.coin ?? 0;
  if (coin < entry.cost) {
    return {
      ok: false,
      reason: `${entry.label} costs ${entry.cost} coin, and the village has ${coin}`,
    };
  }
  add(state.posting.resources, "coin", -entry.cost, context);
  state.career.unlocks[id] = state.tick;
  return { ok: true };
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

/** The unlock a decree needs and does not have, or null. Used by enactDecree and, in step 3, saveDecree. */
export function missingDecreeUnlock(
  state: GameState,
  decree: Decree,
  tuning: Tuning,
): ArchiveEntry | null {
  const needs = (kinds: readonly string[], id: UnlockId) =>
    !hasUnlock(state, id) &&
    decree.rules.some((rule) => usesKind(rule.when, kinds));
  const missing: UnlockId[] = [];
  if (needs(["all", "any", "not"], COMPOUND_UNLOCK)) {
    missing.push(COMPOUND_UNLOCK);
  }
  if (needs(["chose"], CHAINING_UNLOCK)) missing.push(CHAINING_UNLOCK);
  const id = missing[0];
  if (id === undefined) return null;
  const found = tuning.archive.entries.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`archive entry "${id}" is missing`);
  return found;
}

export function missingDecreeUnlockReason(entry: ArchiveEntry): string {
  return `this decree needs "${entry.label}" from the Archive`;
}

export function ownedUnlocks(state: GameState): UnlockId[] {
  return sortedKeys(state.career.unlocks);
}
