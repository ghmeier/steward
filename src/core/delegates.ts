import type { Job } from "./realm";
import { intBelow } from "./rng";
import type { PostingState } from "./state";

export type Delegate = {
	id: number;
	name: string;
	kind: "peasant";
	job: Job | "idle";
	grudgeUntil: number;
};

export function laborCounts(
	delegates: readonly Delegate[],
): Record<Job, number> {
	const counts: Record<Job, number> = { farm: 0, forest: 0, mine: 0 };
	for (const delegate of delegates) {
		if (delegate.job !== "idle") counts[delegate.job] += 1;
	}
	return counts;
}

export function idleCount(delegates: readonly Delegate[]): number {
	let idle = 0;
	for (const delegate of delegates) if (delegate.job === "idle") idle += 1;
	return idle;
}

export function workingCounts(
	delegates: readonly Delegate[],
	tick: number,
): Record<Job, number> {
	const counts: Record<Job, number> = { farm: 0, forest: 0, mine: 0 };
	for (const delegate of delegates) {
		if (delegate.job !== "idle" && tick >= delegate.grudgeUntil) {
			counts[delegate.job] += 1;
		}
	}
	return counts;
}

/** The roster is in id order, so the first match is the lowest id. */
export function lowestInJob(
	delegates: readonly Delegate[],
	job: Job | "idle",
): Delegate | undefined {
	return delegates.find((delegate) => delegate.job === job);
}

/** A peasant under a grudge refuses new work, so labor moves skip them. */
export function lowestFreeInJob(
	delegates: readonly Delegate[],
	job: Job | "idle",
	tick: number,
): Delegate | undefined {
	return delegates.find(
		(delegate) => delegate.job === job && tick >= delegate.grudgeUntil,
	);
}

export function removeDelegate(delegates: Delegate[], id: number): void {
	const index = delegates.findIndex((delegate) => delegate.id === id);
	if (index >= 0) delegates.splice(index, 1);
}

// Names are drawn only among those no living peasant holds, so living names stay unique;
// tuning guarantees at least maxPopulation names, so a free one always exists below the cap.
function drawName(posting: PostingState, names: readonly string[]): string {
	const held = new Set(posting.delegates.map((delegate) => delegate.name));
	const free = names.filter((name) => !held.has(name));
	const stream = posting.rng.names;
	if (stream === undefined || free.length === 0) {
		throw new Error("no free peasant name to draw");
	}
	const name = free[intBelow(stream, free.length)];
	if (name === undefined) throw new Error("no free peasant name to draw");
	return name;
}

export function bearPeasant(
	posting: PostingState,
	names: readonly string[],
): Delegate {
	const delegate: Delegate = {
		id: posting.nextDelegateId,
		name: drawName(posting, names),
		kind: "peasant",
		job: "idle",
		grudgeUntil: 0,
	};
	posting.nextDelegateId += 1;
	posting.delegates.push(delegate);
	return delegate;
}
