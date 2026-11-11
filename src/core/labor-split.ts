import { copy } from "./copy";
import { WORKING_JOBS, type WorkingJob } from "./realm";

export type LaborWeights = Record<WorkingJob, number>;
export type LaborSplitResult =
  | { ok: true; split: LaborSplit }
  | { ok: false; problem: string };

const WEIGHT = /^\d+(\.\d+)?$/;

function isWorkingJob(word: string): word is WorkingJob {
  return (WORKING_JOBS as readonly string[]).includes(word);
}

/**
 * A labor policy written as its own split, such as "farm 60 forest 30 mine 10". Named presets never
 * contain a space, so a space is what marks a policy as a split. The weights are relative: only their
 * proportions matter, and a job left out gets none.
 */
export class LaborSplit {
  constructor(readonly weights: LaborWeights) {}

  static isSplit(policy: string): boolean {
    return /\s/.test(policy.trim());
  }

  static parse(policy: string): LaborSplitResult {
    const words = policy.trim().split(/\s+/);
    if (words.length % 2 !== 0) {
      return { ok: false, problem: copy.laborSplit.unpaired };
    }
    const entries: [string, number][] = [];
    for (let index = 0; index < words.length; index += 2) {
      const job = words[index] ?? "";
      const text = words[index + 1] ?? "";
      if (!WEIGHT.test(text)) {
        return { ok: false, problem: copy.laborSplit.badWeight({ job, text }) };
      }
      entries.push([job, Number(text)]);
    }
    return LaborSplit.fromEntries(entries);
  }

  static fromEntries(entries: readonly [string, number][]): LaborSplitResult {
    const weights: LaborWeights = { farm: 0, forest: 0, mine: 0 };
    const seen = new Set<string>();
    for (const [job, weight] of entries) {
      if (!isWorkingJob(job)) {
        return { ok: false, problem: copy.laborSplit.unknownJob({ job }) };
      }
      if (seen.has(job)) {
        return { ok: false, problem: copy.laborSplit.duplicateJob({ job }) };
      }
      if (!Number.isFinite(weight) || weight < 0) {
        return {
          ok: false,
          problem: copy.laborSplit.badWeight({ job, text: String(weight) }),
        };
      }
      seen.add(job);
      weights[job] = weight;
    }
    if (new LaborSplit(weights).total === 0) {
      return { ok: false, problem: copy.laborSplit.allZero };
    }
    return { ok: true, split: new LaborSplit(weights) };
  }

  /** The policy text for a split: jobs in a fixed order, so equal splits are written the same way. */
  format(separator = " "): string {
    return WORKING_JOBS.filter((job) => this.weights[job] > 0)
      .map((job) => `${job} ${this.weights[job]}`)
      .join(separator);
  }

  /** Shares that sum to one, which is what `EconomyManager.laborTargets` divides the peasants by. */
  shares(): LaborWeights {
    const { weights, total } = this;
    return {
      farm: weights.farm / total,
      forest: weights.forest / total,
      mine: weights.mine / total,
    };
  }

  get total(): number {
    return this.weights.farm + this.weights.forest + this.weights.mine;
  }
}
