import { z } from "zod";
import type { CommandResult } from "./commands";
import { copy } from "./copy";
import type { FavorBand } from "./crown";
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
  startedAt: count,
  endedAt: count,
  ending: z.enum(ENDINGS),
  favor: z.number().min(-100).max(100),
  demandsMet: count,
  demandsMissed: count,
});

const province = z.strictObject({ id: name, label: name });
type Province = z.infer<typeof province>;

export const prestigeTuningSchema = z
  .strictObject({
    /** Crown demands met in a posting before the steward may ask to leave it. */
    demandsMet: positiveInteger,
    /** Peasants a new posting begins with. */
    population: positiveInteger,
    resources: z.record(z.enum(RESOURCES), nonNegative),
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

  provinceLabel(id: string): string {
    return this.provinces.find((entry) => entry.id === id)?.label ?? id;
  }

  get openRecord(): Omit<PostingRecord, "endedAt" | "ending"> {
    const { index, name, province, startedAt, crown } = this.posting;
    return {
      index,
      name,
      province,
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

  end(newName: string): CommandResult {
    const title = newName.trim();
    if (title === "") throw new Error(copy.prestige.nameRequired);
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

    const seed = this.nextSeed;
    const provinceId = this.drawProvince(ending, seed);
    this.game.unlocks.dropPostingScoped();
    state.posting = newPosting(seed, title, tuning, {
      index: state.posting.index + 1,
      startedAt: state.tick,
      resources: this.tuning.resources,
      province: provinceId,
    });
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
