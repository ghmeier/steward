import type { CommandResult } from "./commands";
import { isRecord, sortedKeys } from "./data";
import {
  DECREE_ID_PATTERN,
  type Decree,
  decreePolicyProblem,
  parseDecree,
} from "./decree";
import { enactDecree, policiesFor } from "./decree-engine";
import { errorMessage } from "./errors";
import type { GameState } from "./state";
import type { Tuning } from "./tuning";
import {
  hasUnlock,
  missingDecreeUnlock,
  missingDecreeUnlockReason,
  SAVED_DECREES_UNLOCK,
} from "./unlocks";

function lockedReason(state: GameState, tuning: Tuning): string | null {
  if (hasUnlock(state, SAVED_DECREES_UNLOCK)) return null;
  const label =
    tuning.archive.entries.find((entry) => entry.id === SAVED_DECREES_UNLOCK)
      ?.label ?? SAVED_DECREES_UNLOCK;
  return `saved decrees need "${label}" from the Archive`;
}

export function saveDecree(
  state: GameState,
  name: string,
  decree: unknown,
  tuning: Tuning,
): CommandResult {
  const locked = lockedReason(state, tuning);
  if (locked !== null) return { ok: false, reason: locked };
  if (!DECREE_ID_PATTERN.test(name)) {
    return { ok: false, reason: `"${name}" is not a valid decree name` };
  }

  let parsed: Decree;
  try {
    // The name is the decree's id, so a pasted decree need not carry a matching one.
    const named = isRecord(decree) ? { ...decree, id: name } : decree;
    parsed = parseDecree(named, tuning.decrees);
  } catch (error) {
    return { ok: false, reason: errorMessage(error) };
  }

  const missing = missingDecreeUnlock(state, parsed, tuning);
  if (missing !== null) {
    return { ok: false, reason: missingDecreeUnlockReason(missing) };
  }
  const policyProblem = decreePolicyProblem(
    parsed,
    policiesFor(parsed.petition, tuning),
  );
  if (policyProblem !== null) return { ok: false, reason: policyProblem };

  const saved = state.career.savedDecrees;
  if (
    !Object.hasOwn(saved, name) &&
    sortedKeys(saved).length >= tuning.archive.maxSaved
  ) {
    return {
      ok: false,
      reason: `only ${tuning.archive.maxSaved} decrees can be saved`,
    };
  }
  saved[name] = parsed;
  return { ok: true };
}

export function enactSaved(
  state: GameState,
  name: string,
  tuning: Tuning,
): CommandResult {
  const locked = lockedReason(state, tuning);
  if (locked !== null) return { ok: false, reason: locked };
  const saved = state.career.savedDecrees;
  const found = Object.hasOwn(saved, name) ? saved[name] : undefined;
  if (found === undefined) {
    return { ok: false, reason: `no saved decree "${name}"` };
  }

  const active = sortedKeys(state.posting.decrees)
    .map((id) => state.posting.decrees[id])
    .find((decree) => decree?.petition === found.petition);
  const id = active?.id ?? found.petition;
  return enactDecree(state, { ...structuredClone(found), id }, tuning);
}

export function forgetSaved(state: GameState, name: string): CommandResult {
  const saved = state.career.savedDecrees;
  if (!Object.hasOwn(saved, name)) {
    return { ok: false, reason: `no saved decree "${name}"` };
  }
  delete saved[name];
  return { ok: true };
}
