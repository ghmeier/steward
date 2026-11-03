/**
 * Stands for "no labor decree in force". Saved state cannot hold null, so the absence of a policy
 * is a name no allocation can have.
 */
export const NO_LABOR_POLICY = "";

export type LaborState = { policy: string; settling: boolean };

/** Tracks whether a labor decree is still moving peasants toward its split. */
export class LaborSettling {
  constructor(private game: { state: { posting: { labor: LaborState } } }) {}

  private get state() {
    return this.game.state.posting.labor;
  }

  get settling(): boolean {
    return this.state.settling;
  }

  /** The policy chosen last tick, or null when no labor decree was in force. */
  get policy(): string | null {
    return this.state.policy === NO_LABOR_POLICY ? null : this.state.policy;
  }

  /** Starts settling when the chosen policy differs from last tick's, which includes a first enactment. */
  observe(policy: string): void {
    if (policy === this.state.policy) return;
    this.state.policy = policy;
    this.state.settling = true;
  }

  stop(): void {
    this.state.settling = false;
  }

  forget(): void {
    this.state.policy = NO_LABOR_POLICY;
    this.state.settling = false;
  }
}
