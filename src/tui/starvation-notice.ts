import { copy } from "../core/copy";
import type { GameView } from "../core/view";

/**
 * Names the peasants who left the roster between two views, but only when the starved count rose:
 * the roster only shrinks by starvation today, and capping at the count's increase keeps a future
 * way of leaving from being reported as a death.
 */
export function starvationNotice(
  previous: GameView,
  next: GameView,
): string | null {
  const deaths = next.realm.starved - previous.realm.starved;
  if (deaths <= 0) return null;
  const remaining = new Set(next.delegates.map((delegate) => delegate.id));
  const names = previous.delegates
    .filter((delegate) => !remaining.has(delegate.id))
    .slice(0, deaths)
    .map((delegate) => delegate.name);
  return copy.notices.starved({ names, deaths });
}
