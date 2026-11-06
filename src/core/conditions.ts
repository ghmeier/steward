import { type Condition, OWED_RESOURCES, type Quantity } from "./decree";
import type { Game } from "./game";

export class ConditionManager {
  constructor(private game: Game) {}

  quantityOf(quantity: Quantity): number {
    const { resources, delegates } = this.game.state.posting;
    switch (quantity) {
      case "coin":
      case "grain":
      case "ore":
      case "wood":
        return resources[quantity] ?? 0;
      case "population":
        return delegates.length;
      case "idle":
        return this.game.delegates.jobCounts().idle;
      case "owedCoin":
      case "owedGrain":
      case "owedOre":
      case "owedWood":
        return this.game.crown.owedIn(OWED_RESOURCES[quantity]);
      case "grainSeasons":
        return this.game.economy.grainSeasons();
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
          this.game.economy.seasonAt(this.game.state.tick) === condition.season
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
