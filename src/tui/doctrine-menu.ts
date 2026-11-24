import { copy } from "../core/copy";
import type { Doctrine } from "../core/prestige";
import { MODIFIERS, type ModifierId } from "../core/unlocks";
import { plain } from "./format";
import type { ScreenBuilder } from "./menu";

/** A raise in these is a cost to the steward, not a bonus. */
const LOWER_IS_BETTER: ReadonlySet<ModifierId> = new Set([
  "interest",
  "governorDeath",
]);

class Effect {
  constructor(
    private readonly id: ModifierId,
    private readonly value: number,
  ) {}

  private get isFactor(): boolean {
    return MODIFIERS[this.id] === "factor";
  }

  private get raises(): boolean {
    return this.isFactor ? this.value > 1 : this.value > 0;
  }

  get helps(): boolean {
    return this.raises !== LOWER_IS_BETTER.has(this.id);
  }

  get text(): string {
    const figure = plain(this.value);
    const change = this.isFactor
      ? `×${figure}`
      : `${this.raises ? "+" : ""}${figure}`;
    return `${copy.menus.modifierNames[this.id]} ${change}`;
  }
}

class DoctrineSummary {
  constructor(private readonly doctrine: Doctrine) {}

  private get effects(): Effect[] {
    return Object.entries(this.doctrine.effects).map(
      ([id, value]) => new Effect(id as ModifierId, value),
    );
  }

  private listed(helps: boolean): string {
    const lines = this.effects
      .filter((effect) => effect.helps === helps)
      .map((effect) => effect.text);
    return lines.length === 0 ? copy.menus.doctrineNone : lines.join(", ");
  }

  get text(): string {
    const { label, rule } = this.doctrine;
    return copy.menus.doctrineSummary({
      label,
      bonus: this.listed(true),
      cost: this.listed(false),
      rule: rule.label,
      description: rule.description,
    });
  }
}

/** The choice carries to the name prompt rather than ending the posting here, so escaping the prompt still ends nothing. */
export const doctrineMenu: ScreenBuilder = ({ tuning }) => {
  const { entries } = tuning.doctrines;
  return {
    kind: "list",
    title: copy.menus.doctrineTitle,
    notes: [
      copy.menus.doctrineIntro,
      "",
      ...entries.flatMap((entry) => [new DoctrineSummary(entry).text, ""]),
    ],
    items: entries.map((entry) => ({
      label: entry.label,
      action: {
        kind: "app",
        request: { kind: "endPosting", doctrine: entry.id },
      },
    })),
  };
};
