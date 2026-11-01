import { isRecord, sortedKeys } from "./data";
import {
  DECREE_ID_PATTERN,
  type Decree,
  decreePolicyProblem,
  parseDecree,
} from "./decree";
import { errorMessage } from "./errors";
import type { GameStateManager } from "./state";
import { missingDecreeUnlockReason, SAVED_DECREES_UNLOCK } from "./unlocks";

export class SavedDecreeManager {
  constructor(private manager: GameStateManager) {}

  private lockedReason(): string | null {
    if (this.manager.um.enabled(SAVED_DECREES_UNLOCK)) return null;
    const label =
      this.manager.tuning.archive.entries.find(
        (entry) => entry.id === SAVED_DECREES_UNLOCK,
      )?.label ?? SAVED_DECREES_UNLOCK;
    return `saved decrees need "${label}" from the Archive`;
  }

  save(name: string, decree: unknown): void {
    const locked = this.lockedReason();
    if (locked !== null) throw new Error(locked);
    if (!DECREE_ID_PATTERN.test(name)) {
      throw new Error(`"${name}" is not a valid decree name`);
    }

    let parsed: Decree;
    try {
      // The name is the decree's id, so a pasted decree need not carry a matching one.
      const named = isRecord(decree) ? { ...decree, id: name } : decree;
      parsed = parseDecree(named, this.manager.tuning.decrees);
    } catch (error) {
      throw new Error(errorMessage(error));
    }

    const missing = this.manager.um.missingDecreeUnlock(parsed);
    if (missing !== null) {
      throw new Error(missingDecreeUnlockReason(missing));
    }
    const policyProblem = decreePolicyProblem(
      parsed,
      this.manager.de.policiesFor(parsed.petition),
    );
    if (policyProblem !== null) throw new Error(policyProblem);

    const saved = this.manager.state.career.savedDecrees;
    if (
      !Object.hasOwn(saved, name) &&
      sortedKeys(saved).length >= this.manager.tuning.archive.maxSaved
    ) {
      throw new Error(
        `only ${this.manager.tuning.archive.maxSaved} decrees can be saved`,
      );
    }
    saved[name] = parsed;
  }

  enact(name: string): void {
    const locked = this.lockedReason();
    if (locked !== null) throw new Error(locked);
    const saved = this.manager.state.career.savedDecrees;
    const found = Object.hasOwn(saved, name) ? saved[name] : undefined;
    if (found === undefined) {
      throw new Error(`no saved decree "${name}"`);
    }

    const active = sortedKeys(this.manager.state.posting.decrees)
      .map((id) => this.manager.state.posting.decrees[id])
      .find((decree) => decree?.petition === found.petition);
    const id = active?.id ?? found.petition;
    this.manager.de.enact({ ...structuredClone(found), id });
  }

  forget(name: string): void {
    const saved = this.manager.state.career.savedDecrees;
    if (!Object.hasOwn(saved, name)) {
      throw new Error(`no saved decree "${name}"`);
    }
    delete saved[name];
  }
}
