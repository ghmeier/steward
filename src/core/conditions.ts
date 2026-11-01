import type { Condition, Quantity } from "./decree";
import type { GameStateManager } from "./state";

export class ConditionManager {
  constructor(private manager: GameStateManager) {}

  quantityOf(quantity: Quantity): number {
    const { resources, delegates } = this.manager.state.posting;
    switch (quantity) {
      case "coin":
      case "grain":
      case "ore":
      case "wood":
        return resources[quantity] ?? 0;
      case "population":
        return delegates.length;
      case "idle":
        return this.manager.dm.jobCounts().idle;
      case "grainSeasons":
        return this.manager.em.grainSeasons();
    }
  }

  evaluate(
    condition: Condition,
    chosen: Readonly<Record<string, string>>,
  ): boolean {
    switch (condition.kind) {
      case "compare": {
        const value = this.quantityOf(condition.quantity);
        return condition.comparison === "above"
          ? value > condition.value
          : value < condition.value;
      }
      case "season":
        return (
          this.manager.em.seasonAt(this.manager.state.tick) === condition.season
        );
      case "chose":
        return (
          Object.hasOwn(chosen, condition.decree) &&
          chosen[condition.decree] === condition.policy
        );
      case "all":
        return condition.conditions.every((child) =>
          this.evaluate(child, chosen),
        );
      case "any":
        return condition.conditions.some((child) =>
          this.evaluate(child, chosen),
        );
      case "not":
        return !this.evaluate(condition.condition, chosen);
    }
  }
}
