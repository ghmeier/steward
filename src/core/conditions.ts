import type { Condition, Quantity } from "./decree";
import { idleCount } from "./delegates";
import { grainSeasons, seasonAt } from "./economy";
import type { GameState } from "./state";
import type { Tuning } from "./tuning";

export function quantityValue(
  quantity: Quantity,
  state: GameState,
  tuning: Tuning,
): number {
  const { resources, delegates } = state.posting;
  switch (quantity) {
    case "coin":
    case "grain":
    case "ore":
    case "wood":
      return resources[quantity] ?? 0;
    case "population":
      return delegates.length;
    case "idle":
      return idleCount(delegates);
    case "grainSeasons":
      return grainSeasons(state, tuning);
  }
}

export function evaluateCondition(
  condition: Condition,
  state: GameState,
  tuning: Tuning,
  chosen: Readonly<Record<string, string>>,
): boolean {
  switch (condition.kind) {
    case "compare": {
      const value = quantityValue(condition.quantity, state, tuning);
      return condition.comparison === "above"
        ? value > condition.value
        : value < condition.value;
    }
    case "season":
      return (
        seasonAt(state.tick, tuning.economy.ticksPerSeason) === condition.season
      );
    case "chose":
      return (
        Object.hasOwn(chosen, condition.decree) &&
        chosen[condition.decree] === condition.policy
      );
    case "all":
      return condition.conditions.every((child) =>
        evaluateCondition(child, state, tuning, chosen),
      );
    case "any":
      return condition.conditions.some((child) =>
        evaluateCondition(child, state, tuning, chosen),
      );
    case "not":
      return !evaluateCondition(condition.condition, state, tuning, chosen);
  }
}
