import { Job } from "./realm";
import { intBelow } from "./rng";
import type { GameStateManager } from "./state";

export type Delegate = {
  id: number;
  name: string;
  kind: "peasant";
  job: Job;
  grudgeUntil: number;
};

type DelegateCounts = Record<Job, number> & { idle: number };

export class DelegateManager {
  constructor(private manager: GameStateManager) {}

  get delegates() {
    return this.manager.state.posting.delegates;
  }

  get availableNames() {
    return this.manager.tuning.village.names;
  }

  jobCounts(): DelegateCounts {
    const counts: DelegateCounts = {
      farm: 0,
      forest: 0,
      mine: 0,
      idle: 0,
    };
    for (const delegate of this.delegates) {
      counts[delegate.job] += 1;
    }
    return counts;
  }

  workingCountsAt(tick: number): Record<Job, number> {
    const counts: Record<Job, number> = {
      farm: 0,
      forest: 0,
      mine: 0,
      idle: 0,
    };
    for (const delegate of this.delegates) {
      if (tick >= delegate.grudgeUntil) {
        counts[delegate.job] += 1;
      } else {
        counts.idle += 1;
      }
    }
    return counts;
  }

  firstWithJob(job: Job): Delegate | undefined {
    return this.delegates.find((delegate) => delegate.job === job);
  }

  firstFreeWithJob(job: Job, tick: number): Delegate | undefined {
    return this.delegates.find(
      (delegate) => delegate.job === job && tick >= delegate.grudgeUntil,
    );
  }

  findById(id: number): Delegate | undefined {
    return this.delegates.find((d) => d.id === id);
  }

  assignJob(id: number, job: Job) {
    const assignee = this.findById(id);
    if (!assignee) {
      throw new Error(`no assignee with id ${id}`);
    }
    if (job === assignee.job) {
      if (job === Job.IDLE) throw new Error(`${assignee.name} is already idle`);
      throw new Error(`${assignee.name} already works the ${job}`);
    }
    if (job !== Job.IDLE && this.manager.state.tick < assignee.grudgeUntil) {
      throw new Error(`${assignee.name} holds a grudge and refuses to work`);
    }
    assignee.job = job;
  }

  remove(id: number): void {
    const index = this.delegates.findIndex((delegate) => delegate.id === id);
    if (index >= 0) this.delegates.splice(index, 1);
  }

  // Picks an unused name.
  findName(): string {
    const held = new Set(this.delegates.map((delegate) => delegate.name));
    const free = this.availableNames.filter((name) => !held.has(name));
    const stream = this.manager.state.posting.rng.names;
    if (stream === undefined || free.length === 0) {
      throw new Error("no free peasant name to draw");
    }
    const name = free[intBelow(stream, free.length)];
    if (name === undefined) throw new Error("no free peasant name to draw");
    return name;
  }

  create(): Delegate {
    const delegate: Delegate = {
      id: this.manager.state.posting.nextDelegateId,
      name: this.findName(),
      kind: "peasant",
      job: Job.IDLE,
      grudgeUntil: 0,
    };
    this.manager.state.posting.nextDelegateId += 1;
    this.delegates.push(delegate);
    return delegate;
  }
}
