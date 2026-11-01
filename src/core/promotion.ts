import type { GameState } from "./state";
import type { Tuning } from "./tuning";

/** Promotion is never revoked, so a village that later shrinks stays promoted. */
export function checkPromotion(state: GameState, tuning: Tuning): void {
  if (state.career.promotedAt !== 0) return;
  if (state.posting.delegates.length >= tuning.village.promotionPopulation) {
    state.career.promotedAt = state.tick;
  }
}
