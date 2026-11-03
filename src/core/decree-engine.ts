import { compareKeys, sortedKeys } from "./data";
import {
  type Condition,
  choseConditions,
  type Decree,
  decreePolicyProblem,
  decreeReferences,
  decreeSetProblem,
  formatCycle,
  orderDecrees,
  PETITION_RESOURCE,
  type Petition,
  parseDecree,
  policiesFor,
  type ResourcePetition,
} from "./decree";
import type { EconomyFlows } from "./economy";
import { errorMessage } from "./errors";
import type { Game } from "./game";
import type { AddContext } from "./math";
import { missingDecreeUnlockReason } from "./unlocks";

export { HARVEST_POLICIES } from "./decree";

export class DecreeEngine {
  constructor(private game: Game) {}

  policiesFor(petition: Petition): readonly string[] {
    return policiesFor(petition, this.game.tuning);
  }

  get enacted() {
    return this.game.state.posting.decrees;
  }

  get limits() {
    return this.game.tuning.decrees;
  }

  enact(value: unknown): void {
    let decree: Decree;
    try {
      decree = parseDecree(value, this.limits);
    } catch (error) {
      throw new Error(errorMessage(error));
    }

    const missing = this.game.unlocks.missingDecreeUnlock(decree);
    if (missing !== null) {
      throw new Error(missingDecreeUnlockReason(missing));
    }

    const candidate: Record<string, Decree> = {
      ...this.enacted,
      [decree.id]: decree,
    };
    const problem = decreeSetProblem(
      candidate,
      this.policiesFor("labor"),
      decree.id,
    );
    if (problem !== null) throw new Error(problem);

    this.enacted[decree.id] = decree;
  }

  repeal(id: string): void {
    if (!Object.hasOwn(this.enacted, id)) {
      throw new Error(`no active decree "${id}"`);
    }
    for (const other of sortedKeys(this.enacted)) {
      const decree = this.enacted[other];
      if (other !== id && decree && decreeReferences(decree).includes(id)) {
        throw new Error(`decree "${other}" references "${id}"`);
      }
    }
    this.remove(id);
  }

  // Forgetting at removal rather than on the next tick keeps a re-enactment before that tick
  // reading as a policy change, and keeps a newborn from being placed by a repealed decree.
  private remove(id: string): void {
    if (this.enacted[id]?.petition === "labor") this.game.labor.forget();
    delete this.enacted[id];
  }

  /**
   * Labor policies come from tuning, which state validation cannot see, so a save can hold a labor
   * decree whose allocation has since been removed. Dropping those, and any decree that chains on
   * a dropped one, keeps the remaining set runnable instead of failing on the next step.
   */
  repealStale(): string[] {
    const removed = new Set<string>();
    // A chose test on a policy its target can no longer choose would fail every later enactment.
    const isStale = (decree: Decree): boolean =>
      decreePolicyProblem(decree, this.policiesFor(decree.petition)) !== null ||
      choseConditions(decree).some((test) => {
        const target = Object.hasOwn(this.enacted, test.decree)
          ? this.enacted[test.decree]
          : undefined;
        return (
          target !== undefined &&
          !this.policiesFor(target.petition).includes(test.policy)
        );
      });
    for (const id of sortedKeys(this.enacted)) {
      const decree = this.enacted[id];
      if (decree && isStale(decree)) removed.add(id);
    }
    let grew = removed.size > 0;
    while (grew) {
      grew = false;
      for (const id of sortedKeys(this.enacted)) {
        const decree = this.enacted[id];
        if (
          decree &&
          !removed.has(id) &&
          decreeReferences(decree).some((ref) => removed.has(ref))
        ) {
          removed.add(id);
          grew = true;
        }
      }
    }
    const ids = [...removed].sort(compareKeys);
    for (const id of ids) this.remove(id);
    return ids;
  }

  run(context: AddContext, flows: EconomyFlows): Record<string, string> {
    const decrees = this.enacted;
    const order = orderDecrees(decrees);
    if (!order.ok) {
      throw new Error(
        `active decrees form a cycle: ${formatCycle(order.cycle)}`,
      );
    }

    const chosen: Record<string, string> = {};
    let laborInForce = false;
    for (const id of order.order) {
      const decree = decrees[id];
      if (!decree) continue;
      const matched = decree.rules.find((rule) =>
        this.game.conditions.evaluate(rule.when, chosen),
      );
      const policy = matched ? matched.policy : decree.otherwise;
      chosen[id] = policy;

      if (decree.petition !== "labor") {
        const resource = PETITION_RESOURCE[decree.petition];
        const amount = this.resourceAmount(
          resource,
          matched?.when,
          flows[decree.petition],
        );
        if (policy === "sell") {
          this.game.economy.sellResource(resource, amount, context);
        } else if (policy === "feed" && decree.petition === "harvest") {
          this.game.economy.feedGrain(amount, context);
        } else if (policy !== "stockpile") {
          throw new Error(`unknown ${decree.petition} policy "${policy}"`);
        }
      } else {
        laborInForce = true;
        this.game.labor.apply(policy);
      }
    }
    if (!laborInForce) this.game.labor.forget();
    return chosen;
  }

  // A bare "resource above N" rule means everything over N, not just this tick's production.
  private resourceAmount(
    resource: (typeof PETITION_RESOURCE)[ResourcePetition],
    when: Condition | undefined,
    produced: number,
  ): number {
    const stock = this.game.state.posting.resources[resource] ?? 0;
    if (
      when?.kind === "compare" &&
      when.comparison === "above" &&
      when.quantity === resource
    ) {
      return Math.max(0, stock - Math.max(0, when.value));
    }
    return Math.min(produced, stock);
  }
}
