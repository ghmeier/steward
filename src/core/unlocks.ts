import { z } from "zod";
import type { Command } from "./commands";
import { copy } from "./copy";
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
import { RESOURCES, type Resource } from "./realm";
import { name, positive, positiveInteger, repeatIssues } from "./schema";

export type UnlockId = string;
export type ArchiveCost = Partial<Record<Resource, number>>;
/** Reveals an entry once the village is promoted, which no stock condition can express. */
const PROMOTION = "promotion";
/** An entry with no `shown` is on offer from the start. */
export type ArchiveShown = Condition | typeof PROMOTION;
export type ArchiveEntry = {
  id: UnlockId;
  label: string;
  description: string;
  cost: ArchiveCost;
  requires: UnlockId[];
  shown?: ArchiveShown | undefined;
};
export type ArchiveCostPart = {
  resource: Resource;
  amount: number;
  /** The stock on hand, conjured units included. */
  held: number;
  affordable: boolean;
};
export type PlayUnlock = { id: UnlockId; label: string; when: Condition };
export type ArchiveTuning = {
  maxSaved: number;
  entries: ArchiveEntry[];
  play: PlayUnlock[];
};

export type PanelId =
  | "archive"
  | "court"
  | "crown"
  | "decrees"
  | "ledger"
  | "peasants";

export const ARCHIVE_PANEL: UnlockId = "panel.archive";
export const COURT_PANEL: UnlockId = "panel.court";
export const DECREES_PANEL: UnlockId = "panel.decrees";
export const CROWN_PANEL: UnlockId = "panel.crown";
export const FORGING: UnlockId = "control.forging";
export const GOVERNORS: UnlockId = "control.governors";
export const COMPOUND_UNLOCK: UnlockId = "decree.compound";
export const CHAINING_UNLOCK: UnlockId = "decree.chaining";
export const CROWN_CORRESPONDENCE: UnlockId = "decree.crownCorrespondence";
export const CONJURING: UnlockId = "control.conjuring";
export const EXACT_DEBT: UnlockId = "precision.exact";
export const TRUE_REPORTS: UnlockId = "precision.reports";
export const PALETTE_UNLOCK: UnlockId = "control.palette";
export const SAVED_DECREES_UNLOCK: UnlockId = "control.savedDecrees";

/** The unlock that reveals each panel; the ledger and peasants are always open. */
export const PANEL_UNLOCKS: Partial<Record<PanelId, UnlockId>> = {
  court: COURT_PANEL,
  decrees: DECREES_PANEL,
  archive: ARCHIVE_PANEL,
  crown: CROWN_PANEL,
};

/**
 * The unlock a player needs before issuing each command. Core refuses forging, conjuring, delivering and buying on
 * its own, but not decree or Court commands, so command logs written before those panels were sold still replay;
 * the TUI and the runner gate on this table instead.
 */
export const COMMAND_UNLOCKS = {
  enactDecree: DECREES_PANEL,
  repealDecree: DECREES_PANEL,
  saveDecree: DECREES_PANEL,
  enactSaved: DECREES_PANEL,
  forgetSaved: DECREES_PANEL,
  settleDispute: COURT_PANEL,
  settle: COURT_PANEL,
  deliver: CROWN_PANEL,
  forge: FORGING,
  forgeMissing: FORGING,
  conjure: CONJURING,
  buyUnlock: ARCHIVE_PANEL,
} satisfies Partial<Record<Command["type"], UnlockId>>;

export function unlockFor(type: Command["type"]): UnlockId | undefined {
  const unlocks: Partial<Record<Command["type"], UnlockId>> = COMMAND_UNLOCKS;
  return unlocks[type];
}

/** What an entry costs, in the fixed resource order so that spending and display never depend on key order. */
export function costLines(
  entry: ArchiveEntry,
): { resource: Resource; amount: number }[] {
  return RESOURCES.flatMap((resource) => {
    const amount = entry.cost[resource];
    return amount === undefined ? [] : [{ resource, amount }];
  });
}

export class UnlockManager {
  constructor(private game: Game) {}

  enabled(id: UnlockId) {
    return Object.hasOwn(this.game.state.career.unlocks, id);
  }

  get purchased(): UnlockId[] {
    return sortedKeys(this.game.state.career.unlocks);
  }

  lockedPanels(): PanelId[] {
    return Object.entries(PANEL_UNLOCKS)
      .filter(([, id]) => !this.enabled(id))
      .map(([panel]) => panel as PanelId);
  }

  isSeen(id: UnlockId): boolean {
    return Object.hasOwn(this.game.state.career.seen, id);
  }

  /** Revealed at some point, not owned, and with every prerequisite owned. */
  isOffered(entry: ArchiveEntry): boolean {
    return (
      this.isSeen(entry.id) &&
      !this.enabled(entry.id) &&
      entry.requires.every((id) => this.enabled(id))
    );
  }

  offered(): ArchiveEntry[] {
    return this.game.tuning.archive.entries.filter((entry) =>
      this.isOffered(entry),
    );
  }

  costParts(entry: ArchiveEntry): ArchiveCostPart[] {
    return costLines(entry).map(({ resource, amount }) => {
      const held = this.game.illusion.apparent(resource);
      return { resource, amount, held, affordable: held >= amount };
    });
  }

  /** Whether buying the entry now would succeed. */
  canBuy(entry: ArchiveEntry): boolean {
    return (
      this.enabled(ARCHIVE_PANEL) &&
      this.isOffered(entry) &&
      this.costParts(entry).every((part) => part.affordable)
    );
  }

  private isRevealed(shown: ArchiveShown | undefined): boolean {
    if (shown === undefined) return true;
    if (shown === PROMOTION) return this.game.state.career.promotedAt !== 0;
    return this.game.conditions.evaluate(shown, {});
  }

  run(): void {
    const { play, entries } = this.game.tuning.archive;
    const { career, tick } = this.game.state;
    const sortedPlay = [...play].sort((a, b) => compareKeys(a.id, b.id));
    for (const unlock of sortedPlay) {
      if (this.enabled(unlock.id)) continue;
      if (this.game.conditions.evaluate(unlock.when, {})) {
        career.unlocks[unlock.id] = tick;
      }
    }
    for (const entry of entries) {
      if (!this.isSeen(entry.id) && this.isRevealed(entry.shown)) {
        career.seen[entry.id] = tick;
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
    if (!this.isSeen(id)) {
      throw new Error(copy.archive.notOffered({ label: entry.label }));
    }
    const parts = this.costParts(entry);
    const short = parts.find((part) => !part.affordable);
    if (short !== undefined) {
      throw new Error(
        copy.archive.cannotAfford({
          label: entry.label,
          resource: short.resource,
        }),
      );
    }
    for (const { resource, amount } of parts) {
      this.game.illusion.spend(resource, amount, context);
    }
    this.game.state.career.unlocks[id] = this.game.state.tick;
    if (id === CROWN_PANEL) this.game.crown.scheduleFirstDemand();
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

const archiveCost: z.ZodType<ArchiveCost> = z
  .partialRecord(z.enum(RESOURCES), positive)
  .refine((cost) => Object.keys(cost).length > 0, "must cost something");
const archiveEntry: z.ZodType<ArchiveEntry> = z.strictObject({
  id: name,
  label: name,
  description: name,
  cost: archiveCost,
  requires: z.array(name),
  shown: z.union([simpleCondition, z.literal(PROMOTION)]).optional(),
});
const playUnlock: z.ZodType<PlayUnlock> = z.strictObject({
  id: name,
  label: name,
  when: simpleCondition,
});

function archiveIssues(archive: ArchiveTuning, ctx: z.RefinementCtx): void {
  const { entries, play } = archive;
  // The Archive panel itself opens through play, not purchase.
  const gated = new Set([
    ...DECREE_GATES.map(({ id }) => id),
    ...Object.values(PANEL_UNLOCKS),
    ...Object.values(COMMAND_UNLOCKS),
    GOVERNORS,
  ]);
  gated.delete(ARCHIVE_PANEL);
  for (const id of gated) {
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
