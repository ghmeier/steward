import { isRecord, sortedKeys } from "./data";
import {
  DECREE_ID_PATTERN,
  type Decree,
  decreePolicyProblem,
  parseDecree,
} from "./decree";
import { errorMessage } from "./errors";
import type { Game } from "./game";
import { missingDecreeUnlockReason, SAVED_DECREES_UNLOCK } from "./unlocks";

export class SavedDecreeManager {
  constructor(private game: Game) {}

  private lockedReason(): string | null {
    if (this.game.unlocks.enabled(SAVED_DECREES_UNLOCK)) return null;
    const label =
      this.game.tuning.archive.entries.find(
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
      parsed = parseDecree(named, this.game.tuning.decrees);
    } catch (error) {
      throw new Error(errorMessage(error));
    }

    const missing = this.game.unlocks.missingDecreeUnlock(parsed);
    if (missing !== null) {
      throw new Error(missingDecreeUnlockReason(missing));
    }
    const policyProblem = decreePolicyProblem(
      parsed,
      this.game.decrees.policiesFor(parsed.petition),
    );
    if (policyProblem !== null) throw new Error(policyProblem);

    const saved = this.game.state.career.savedDecrees;
    if (
      !Object.hasOwn(saved, name) &&
      sortedKeys(saved).length >= this.game.tuning.archive.maxSaved
    ) {
      throw new Error(
        `only ${this.game.tuning.archive.maxSaved} decrees can be saved`,
      );
    }
    saved[name] = parsed;
  }

  enact(name: string): void {
    const locked = this.lockedReason();
    if (locked !== null) throw new Error(locked);
    const saved = this.game.state.career.savedDecrees;
    const found = Object.hasOwn(saved, name) ? saved[name] : undefined;
    if (found === undefined) {
      throw new Error(`no saved decree "${name}"`);
    }

    const active = sortedKeys(this.game.state.posting.decrees)
      .map((id) => this.game.state.posting.decrees[id])
      .find((decree) => decree?.petition === found.petition);
    const id = active?.id ?? found.petition;
    this.game.decrees.enact({ ...structuredClone(found), id });
  }

  forget(name: string): void {
    const saved = this.game.state.career.savedDecrees;
    if (!Object.hasOwn(saved, name)) {
      throw new Error(`no saved decree "${name}"`);
    }
    delete saved[name];
  }
}
