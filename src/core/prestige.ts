import { z } from "zod";
import type { CommandResult } from "./commands";
import { copy } from "./copy";
import type { FavorBand } from "./crown";
import { addIssue } from "./errors";
import type { Game } from "./game";
import { defaultVillageName, newPosting } from "./posting";
import { RESOURCES } from "./realm";
import { intBelow, nextU32, seedStream } from "./rng";
import {
  count,
  name,
  nonNegative,
  positiveCount,
  positiveInteger,
  repeatIssues,
} from "./schema";
import { type ArchiveEffects, archiveEffectsSchema } from "./unlocks";

export const ENDINGS = ["promotion", "reassignment", "scandal"] as const;
export type Ending = (typeof ENDINGS)[number];

const ENDING_FOR_BAND: Record<FavorBand, Ending> = {
  warm: "promotion",
  neutral: "reassignment",
  cold: "scandal",
};

export type PostingRecord = {
  index: number;
  name: string;
  /** Empty for the first posting. */
  province: string;
  /** Empty for the first posting. */
  doctrine: string;
  startedAt: number;
  endedAt: number;
  ending: Ending;
  favor: number;
  demandsMet: number;
  demandsMissed: number;
};

export const postingRecordSchema: z.ZodType<PostingRecord> = z.strictObject({
  index: positiveCount,
  name: z.string().trim().min(1),
  province: z.string(),
  doctrine: z.string(),
  startedAt: count,
  endedAt: count,
  ending: z.enum(ENDINGS),
  favor: z.number().min(-100).max(100),
  demandsMet: count,
  demandsMissed: count,
});

/** The doctrines whose rule the game's code acts on; the data may rename and retune them but not drop one. */
export const TRADE = "trade";
export const AGRICULTURE = "agriculture";
export const EXTRACTION = "extraction";

export type Doctrine = {
  id: string;
  label: string;
  rule: { label: string; description: string };
  effects: ArchiveEffects;
};

const doctrine: z.ZodType<Doctrine> = z.strictObject({
  id: name,
  label: name,
  rule: z.strictObject({ label: name, description: name }),
  effects: archiveEffectsSchema,
});

export const doctrineTuningSchema = z
  .strictObject({
    /** The share of a season's mined ore that an extraction posting is paid in coin when the season ends. */
    prospectingShare: nonNegative,
    entries: z.array(doctrine),
  })
  .superRefine((value, ctx) => {
    const ids = value.entries.map(({ id }) => id);
    repeatIssues(ids, "doctrine id", ctx, ["entries"]);
    for (const id of [TRADE, AGRICULTURE, EXTRACTION]) {
      if (!ids.includes(id)) addIssue(ctx, `must include "${id}"`, ["entries"]);
    }
  });

const province = z.strictObject({
  id: name,
  label: name,
  effects: archiveEffectsSchema,
  /** How much harder this province makes the crown's demands and the auditors. */
  escalation: z.number().min(1),
});
type Province = z.infer<typeof province>;

export const prestigeTuningSchema = z
  .strictObject({
    /** Crown demands met in a posting before the steward may ask to leave it. */
    demandsMet: positiveInteger,
    /** Peasants a new posting begins with. */
    population: positiveInteger,
    resources: z.record(z.enum(RESOURCES), nonNegative),
    /** What each posting after the first adds to the crown's demands and the auditors, as a share of the first posting's. */
    escalationPerPosting: nonNegative,
    provinces: z.strictObject({
      kind: z.array(province).min(1),
      harsh: z.array(province).min(1),
    }),
  })
  .superRefine((value, ctx) => {
    const ids = [...value.provinces.kind, ...value.provinces.harsh].map(
      ({ id }) => id,
    );
    repeatIssues(ids, "province id", ctx, ["provinces"]);
  });

export type PrestigeTuning = z.infer<typeof prestigeTuningSchema>;

/** A fixed hash of the previous seed and the posting's number, so replaying a command log reaches the same posting. */
export function derivePostingSeed(previousSeed: number, index: number): number {
  return nextU32(seedStream(previousSeed, `posting:${index}`));
}

export class PrestigeManager {
  constructor(private game: Game) {}

  private get tuning(): PrestigeTuning {
    return this.game.tuning.prestige;
  }

  private get posting() {
    return this.game.state.posting;
  }

  get demandsMet(): number {
    return this.posting.crown.met;
  }

  get demandsNeeded(): number {
    return this.tuning.demandsMet;
  }

  get canEnd(): boolean {
    return this.demandsMet >= this.demandsNeeded;
  }

  /** What leaving now would be called; the crown's mood at the moment of leaving is the only thing that decides it. */
  get ending(): Ending {
    return ENDING_FOR_BAND[this.game.crown.band];
  }

  get nextSeed(): number {
    return derivePostingSeed(this.posting.seed, this.posting.index + 1);
  }

  /** The name the runner and any replay without a typed name give the next posting. */
  get defaultName(): string {
    return defaultVillageName(this.nextSeed, this.game.tuning);
  }

  /** Kindest first, so a promotion's two draws are compared by their place in this list. */
  private get provinces(): Province[] {
    const { kind, harsh } = this.tuning.provinces;
    return [...kind, ...harsh];
  }

  private provinceById(id: string): Province | undefined {
    const { kind, harsh } = this.tuning.provinces;
    return (
      kind.find((entry) => entry.id === id) ??
      harsh.find((entry) => entry.id === id)
    );
  }

  private doctrineById(id: string): Doctrine | undefined {
    return this.game.tuning.doctrines.entries.find((entry) => entry.id === id);
  }

  provinceLabel(id: string): string {
    return this.provinceById(id)?.label ?? id;
  }

  get province(): Province | undefined {
    return this.provinceById(this.posting.province);
  }

  get doctrine(): Doctrine | undefined {
    return this.doctrineById(this.posting.doctrine);
  }

  /** Each rule asks for its doctrine by id, so the data can rename and retune a doctrine without touching the rule. */
  hasDoctrine(id: string): boolean {
    return this.posting.doctrine === id;
  }

  /**
   * How much harder the crown and the auditors press than in a first posting: each later posting adds a
   * fixed share of the first's pressure, and the province multiplies the result.
   */
  get escalation(): number {
    const later = this.posting.index - 1;
    return (
      (1 + this.tuning.escalationPerPosting * later) *
      (this.province?.escalation ?? 1)
    );
  }

  get openRecord(): Omit<PostingRecord, "endedAt" | "ending"> {
    const { index, name, province, doctrine, startedAt, crown } = this.posting;
    return {
      index,
      name,
      province,
      doctrine,
      startedAt,
      favor: crown.favor,
      demandsMet: crown.met,
      demandsMissed: crown.missed,
    };
  }

  /**
   * A promotion draws two provinces and takes the kinder, a reassignment takes one from any, and a scandal
   * draws only from the harsh. The draw uses its own stream from the next posting's seed, so it never
   * disturbs a stream the next posting will go on to use.
   */
  private drawProvince(ending: Ending, seed: number): string {
    const all = this.provinces;
    const pool = ending === "scandal" ? this.tuning.provinces.harsh : all;
    const stream = seedStream(seed, "province");
    const draw = () => pool[intBelow(stream, pool.length)] as Province;
    const first = draw();
    if (ending !== "promotion") return first.id;
    const second = draw();
    return all.indexOf(first) <= all.indexOf(second) ? first.id : second.id;
  }

  end(newName: string, doctrineId: string): CommandResult {
    const title = newName.trim();
    if (title === "") throw new Error(copy.prestige.nameRequired);
    if (this.doctrineById(doctrineId) === undefined) {
      throw new Error(copy.prestige.unknownDoctrine({ doctrine: doctrineId }));
    }
    if (!this.canEnd) {
      throw new Error(
        copy.prestige.notYet({
          met: this.demandsMet,
          needed: this.demandsNeeded,
        }),
      );
    }
    const { state, tuning } = this.game;
    const ending = this.ending;
    state.career.postings.push({
      ...this.openRecord,
      endedAt: state.tick,
      ending,
    });

    state.career.followers = this.game.governors.chooseFollowers();

    const seed = this.nextSeed;
    const provinceId = this.drawProvince(ending, seed);
    this.game.unlocks.dropPostingScoped();
    state.posting = newPosting(seed, title, tuning, {
      index: state.posting.index + 1,
      startedAt: state.tick,
      resources: this.tuning.resources,
      province: provinceId,
      doctrine: doctrineId,
    });
    // Followers take their seats first so the roster already holds their names when the peasants are named.
    this.game.governors.seat(state.career.followers);
    this.game.delegates.createPeasants(this.tuning.population);
    // The charter is a career purchase, so nothing in the new posting buys it and schedules the first demand.
    this.game.crown.scheduleFirstDemand();
    return {
      ok: true,
      message: copy.prestige.ended[ending]({
        village: title,
        province: this.provinceLabel(provinceId),
      }),
    };
  }
}
