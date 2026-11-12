import { z } from "zod";
import { compareKeys, sortedKeys } from "./data";
import {
  type Condition,
  conditionSchema,
  type Decree,
  OWED_RESOURCES,
} from "./decree";
import { addIssue } from "./errors";
import type { Game } from "./game";
import type { AddContext } from "./math";
import { name, positive, positiveInteger, repeatIssues } from "./schema";

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

export type PanelId = "archive" | "crown" | "ledger" | "peasants";

export const ARCHIVE_PANEL: UnlockId = "panel.archive";
export const CROWN_PANEL: UnlockId = "panel.crown";
export const COMPOUND_UNLOCK: UnlockId = "decree.compound";
export const CHAINING_UNLOCK: UnlockId = "decree.chaining";
export const CROWN_CORRESPONDENCE: UnlockId = "decree.crownCorrespondence";
export const CONJURING: UnlockId = "control.conjuring";
export const EXACT_DEBT: UnlockId = "precision.exact";
export const TRUE_REPORTS: UnlockId = "precision.reports";
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

  /** Panels hidden until their unlock is bought; the ledger and peasants are always open. */
  lockedPanels(): PanelId[] {
    const locked: PanelId[] = [];
    if (!this.enabled(ARCHIVE_PANEL)) locked.push("archive");
    if (!this.enabled(CROWN_PANEL)) locked.push("crown");
    return locked;
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
    if (this.game.illusion.apparent("coin") < entry.cost) {
      throw new Error(`you do not have enough coin to purchase ${entry.label}`);
    }
    this.game.illusion.spend("coin", entry.cost, context);
    this.game.state.career.unlocks[id] = this.game.state.tick;
  }

  /** The Archive entry a decree needs and the player has not bought, or null. */
  missingDecreeUnlock(decree: Decree): ArchiveEntry | null {
    const gate = DECREE_GATES.find(
      ({ id, matches }) =>
        !this.enabled(id) &&
        decree.rules.some((rule) => someNode(rule.when, matches)),
    );
    if (gate === undefined) return null;
    const { id } = gate;
    const found = this.game.tuning.archive.entries.find(
      (entry) => entry.id === id,
    );
    if (found === undefined)
      throw new Error(`archive entry "${id}" is missing`);
    return found;
  }
}

/** The Archive entries that gate decree syntax, each with the condition nodes it unlocks. */
export const DECREE_GATES: readonly {
  id: UnlockId;
  matches: (node: Condition) => boolean;
}[] = [
  {
    id: COMPOUND_UNLOCK,
    matches: (node) => ["all", "any", "not"].includes(node.kind),
  },
  { id: CHAINING_UNLOCK, matches: (node) => node.kind === "chose" },
  {
    id: CROWN_CORRESPONDENCE,
    matches: (node) =>
      node.kind === "compare" && Object.hasOwn(OWED_RESOURCES, node.quantity),
  },
  {
    // The debt quantity is the exact figure that the Ledger rounds until exact debt is bought.
    id: EXACT_DEBT,
    matches: (node) => node.kind === "compare" && node.quantity === "debt",
  },
];

const simpleCondition: z.ZodType<Condition> = conditionSchema({
  maxRules: 1,
  maxConditionNodes: 8,
  maxConditionDepth: 3,
}).superRefine((condition, ctx) => {
  if (condition.kind !== "compare" && condition.kind !== "season") {
    addIssue(ctx, "must be a compare or season condition");
  }
});

const archiveEntry: z.ZodType<ArchiveEntry> = z.strictObject({
  id: name,
  label: name,
  description: name,
  cost: positive,
  requires: z.array(name),
});
const playUnlock: z.ZodType<PlayUnlock> = z.strictObject({
  id: name,
  label: name,
  when: simpleCondition,
});
const needHook: z.ZodType<NeedHook> = z.strictObject({
  control: name,
  when: simpleCondition,
});

function archiveIssues(archive: ArchiveTuning, ctx: z.RefinementCtx): void {
  const { entries, play, needs } = archive;
  for (const { id } of DECREE_GATES) {
    if (!entries.some((entry) => entry.id === id)) {
      addIssue(ctx, `must include "${id}"`, ["entries"]);
    }
  }
  if (!play.some((unlock) => unlock.id === ARCHIVE_PANEL)) {
    addIssue(ctx, `must include "${ARCHIVE_PANEL}"`, ["play"]);
  }
  repeatIssues(
    [...entries.map((entry) => entry.id), ...play.map((unlock) => unlock.id)],
    "id",
    ctx,
  );
  repeatIssues(
    needs.map((hook) => hook.control),
    "control",
    ctx,
    ["needs"],
  );

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  for (const entry of entries) {
    for (const required of entry.requires) {
      if (!byId.has(required)) {
        addIssue(ctx, `"${entry.id}" requires unknown id "${required}"`, [
          "entries",
        ]);
      }
    }
  }
  const done = new Set<string>();
  const visit = (id: string, trail: string[]): void => {
    if (trail.includes(id)) {
      addIssue(ctx, `requires cycle ${[...trail, id].join(" -> ")}`, [
        "entries",
      ]);
      return;
    }
    if (done.has(id)) return;
    for (const required of byId.get(id)?.requires ?? []) {
      visit(required, [...trail, id]);
    }
    done.add(id);
  };
  for (const entry of entries) visit(entry.id, []);
}

export const archiveTuningSchema: z.ZodType<ArchiveTuning> = z
  .strictObject({
    maxSaved: positiveInteger,
    entries: z.array(archiveEntry),
    play: z.array(playUnlock),
    needs: z.array(needHook),
  })
  .superRefine(archiveIssues);

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
