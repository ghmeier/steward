import { z } from "zod";
import type { Game } from "./game";

/**
 * Stands for "no labor decree in force". State validation and `canonicalStringify` reject null, so
 * the absence of a policy is stored as a name no labor allocation can have.
 */
export const NO_LABOR_POLICY = "";

export type LaborState = { policy: string; settling: boolean };

export const laborStateSchema: z.ZodType<LaborState> = z.strictObject({
  policy: z.string(),
  settling: z.boolean(),
});

export function emptyLaborState(): LaborState {
  return { policy: NO_LABOR_POLICY, settling: false };
}

/** Tracks whether a labor decree is still moving peasants toward its split. */
export class LaborSettling {
  constructor(private game: Game) {}

  private get state() {
    return this.game.state.posting.labor;
  }

  get settling(): boolean {
    return this.state.settling;
  }

  /** The policy chosen last tick. */
  get policy(): string {
    return this.state.policy;
  }

  /** Starts settling when the policy differs from last tick's, which includes a first enactment. */
  apply(policy: string): void {
    if (policy !== this.state.policy) {
      this.state.policy = policy;
      this.state.settling = true;
    }
    if (!this.state.settling) return;
    const { economy } = this.game;
    if (economy.moveLaborToward(economy.laborTargetFor(policy))) this.stop();
  }

  stop(): void {
    this.state.settling = false;
  }

  forget(): void {
    this.state.policy = NO_LABOR_POLICY;
    this.state.settling = false;
  }
}
