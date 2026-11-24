import { copy } from "../core/copy";
import {
  type ArchiveEffects,
  MODIFIERS,
  type ModifierId,
} from "../core/unlocks";

/** The modifiers a player wants to see fall: a smaller interest rate or fewer governor deaths is the better outcome. */
const LOWER_IS_BETTER: ReadonlySet<ModifierId> = new Set([
  "interest",
  "governorDeath",
]);

export type EffectLines = { bonus: string[]; cost: string[] };

/** Splits effects into what helps the steward and what hurts, so a doctrine can show its bonus and its cost apart. */
export function describeEffects(effects: ArchiveEffects): EffectLines {
  const lines: EffectLines = { bonus: [], cost: [] };
  for (const [id, value] of Object.entries(effects) as [ModifierId, number][]) {
    const isFactor = MODIFIERS[id] === "factor";
    const raised = isFactor ? value > 1 : value > 0;
    const text = `${copy.menus.modifierNames[id]} ${
      isFactor ? `×${value}` : `${raised ? "+" : ""}${value}`
    }`;
    (raised !== LOWER_IS_BETTER.has(id) ? lines.bonus : lines.cost).push(text);
  }
  return lines;
}
