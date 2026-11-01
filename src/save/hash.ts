import { canonicalStringify } from "../core/serialize";
import type { GameState } from "../core/state";

// Bun.hash output is not promised stable across Bun versions, so a saved hash could stop
// matching after an upgrade; SHA-256 is specified and fixed.
export function stateHash(state: GameState): string {
  return new Bun.CryptoHasher("sha256")
    .update(canonicalStringify(state))
    .digest("hex");
}
