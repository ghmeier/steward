import { z } from "zod";
import type { Game } from "./game";
import { JOBS, Job, type Trait } from "./realm";
import { intBelow } from "./rng";
import { count, positiveCount, traitList } from "./schema";

type DelegateBase = {
  id: number;
  name: string;
  job: Job;
  grudgeUntil: number;
};

export type Peasant = DelegateBase & { kind: "peasant" };

/** Runs a village of several peasants on one job; the village counts toward population. */
export type Governor = DelegateBase & {
  kind: "governor";
  village: number;
  traits: Trait[];
  hiredAt: number;
  termEndsAt: number;
  /** Coin value the governor has kept back, handed over when they leave. */
  hoard: number;
};

export type Delegate = Peasant | Governor;

const delegateBase = {
  id: positiveCount,
  name: z.string().min(1),
  job: z.enum(JOBS),
  grudgeUntil: count,
};

export const delegateSchema: z.ZodType<Delegate> = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({ ...delegateBase, kind: z.literal("peasant") }),
    z.strictObject({
      ...delegateBase,
      kind: z.literal("governor"),
      village: positiveCount,
      traits: traitList,
      hiredAt: count,
      termEndsAt: count,
      hoard: z.number().min(0),
    }),
  ],
);

export type DelegateView = {
  id: number;
  name: string;
  job: Job | "idle";
  grudgeTicks: number;
};

type DelegateCounts = Record<Job, number> & { idle: number };

export class DelegateManager {
  constructor(private game: Game) {}

  get all() {
    return this.game.state.posting.delegates;
  }

  get availableNames() {
    return this.game.tuning.village.names;
  }

  get peasants(): Peasant[] {
    return this.all.filter((delegate) => delegate.kind === "peasant");
  }

  get governors(): Governor[] {
    return this.all.filter((delegate) => delegate.kind === "governor");
  }

  /** One for each peasant plus each governor's village. */
  get population(): number {
    return this.governors.reduce(
      (total, governor) => total + governor.village,
      this.peasants.length,
    );
  }

  /** Heads of peasants only: labor decrees divide peasants, and governors change job only by hand. */
  jobCounts(): DelegateCounts {
    const counts: DelegateCounts = {
      farm: 0,
      forest: 0,
      mine: 0,
      idle: 0,
    };
    for (const peasant of this.peasants) {
      counts[peasant.job] += 1;
    }
    return counts;
  }

  /** Workers per job: a peasant is one, a governor is their village scaled by their traits. */
  workingCountsAt(tick: number): Record<Job, number> {
    const counts: Record<Job, number> = {
      farm: 0,
      forest: 0,
      mine: 0,
      idle: 0,
    };
    for (const peasant of this.peasants) {
      counts[tick >= peasant.grudgeUntil ? peasant.job : Job.IDLE] += 1;
    }
    for (const governor of this.governors) {
      if (tick >= governor.grudgeUntil) {
        counts[governor.job] += this.game.governors.workersOf(governor);
      } else {
        counts.idle += governor.village;
      }
    }
    return counts;
  }

  view(): DelegateView[] {
    return this.peasants.map((delegate) => ({
      id: delegate.id,
      name: delegate.name,
      job: delegate.job,
      grudgeTicks: Math.max(0, delegate.grudgeUntil - this.game.state.tick),
    }));
  }

  firstWithJob(job: Job): Peasant | undefined {
    return this.peasants.find((peasant) => peasant.job === job);
  }

  firstFreeWithJob(job: Job, tick: number): Peasant | undefined {
    return this.peasants.find(
      (peasant) => peasant.job === job && tick >= peasant.grudgeUntil,
    );
  }

  findById(id: number): Delegate | undefined {
    return this.all.find((d) => d.id === id);
  }

  assignJob(id: number, job: Job) {
    const assignee = this.findById(id);
    if (!assignee) {
      throw new Error(`no peasant ${id}`);
    }
    if (job === assignee.job) {
      if (job === Job.IDLE) throw new Error(`${assignee.name} is already idle`);
      throw new Error(`${assignee.name} already works the ${job}`);
    }
    if (job !== Job.IDLE && this.game.state.tick < assignee.grudgeUntil) {
      throw new Error(`${assignee.name} holds a grudge and refuses to work`);
    }
    assignee.job = job;
  }

  remove(id: number): void {
    const index = this.all.findIndex((delegate) => delegate.id === id);
    if (index >= 0) this.all.splice(index, 1);
  }

  findName(): string {
    const held = new Set(this.all.map((delegate) => delegate.name));
    // A candidate on the desk has been named but is not on the roster yet.
    for (const entry of this.game.desk.candidates) held.add(entry.name);
    const free = this.availableNames.filter((name) => !held.has(name));
    const stream = this.game.state.posting.rng.names;
    if (stream === undefined || free.length === 0) {
      throw new Error("no free peasant name to draw");
    }
    const name = free[intBelow(stream, free.length)];
    if (name === undefined) throw new Error("no free peasant name to draw");
    return name;
  }

  private nextId(): number {
    const id = this.game.state.posting.nextDelegateId;
    this.game.state.posting.nextDelegateId += 1;
    return id;
  }

  createGovernor(
    fields: Omit<Governor, "id" | "kind" | "grudgeUntil">,
  ): Governor {
    const governor: Governor = {
      ...fields,
      id: this.nextId(),
      kind: "governor",
      grudgeUntil: 0,
    };
    this.all.push(governor);
    return governor;
  }

  create(): Peasant {
    const name = this.findName();
    const delegate: Peasant = {
      id: this.nextId(),
      name,
      kind: "peasant",
      job: Job.IDLE,
      grudgeUntil: 0,
    };
    this.all.push(delegate);
    return delegate;
  }
}
