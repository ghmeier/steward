import { describe, expect, test } from "bun:test";
import { tuning } from "../../test/helpers";
import { copy } from "../core/copy";
import type { CrownDemandView, CrownView } from "../core/view";
import { crownNotice } from "./crown-notices";

const { lines } = tuning.crown;
const season = tuning.economy.ticksPerSeason;

const demand: CrownDemandView = {
  resource: "ore",
  amount: 80,
  delivered: 0,
  ticksLeft: tuning.crown.deadlineTicks,
  herald: "The crown requires 80 ore for the armory.",
};
const crown = (
  open: Partial<CrownDemandView> | null,
  tally: { met?: number; missed?: number } = {},
): CrownView => ({
  demand: open === null ? null : { ...demand, ...open },
  nextDemandTicks: open === null ? 1200 : null,
  favor: "neutral",
  met: tally.met ?? 0,
  missed: tally.missed ?? 0,
});

describe("crownNotice", () => {
  test("a new demand reports its herald line once", () => {
    const issued = crown({});

    expect(crownNotice(crown(null), issued, tuning)).toBe(demand.herald);
    expect(
      crownNotice(issued, crown({ ticksLeft: demand.ticksLeft - 1 }), tuning),
    ).toBeNull();
  });

  test("one season left is reported on the frame that crosses it and not after", () => {
    const before = crown({ ticksLeft: season + 1 });
    const crossing = crown({ ticksLeft: season });

    expect(crownNotice(before, crossing, tuning)).toBe(
      copy.notices.oneSeasonLeft({ amount: "80", resource: "ore" }),
    );
    expect(
      crownNotice(crossing, crown({ ticksLeft: season - 1 }), tuning),
    ).toBeNull();
  });

  test("a resolved demand reports the met or missed line with the full amount asked", () => {
    const open = crown({ delivered: 30, ticksLeft: 5 });
    const met = crown(null, { met: 1 });
    const missed = crown(null, { missed: 1 });

    expect(crownNotice(open, met, tuning)).toBe(
      lines.ore.met.replaceAll("{amount}", String(demand.amount)),
    );
    expect(crownNotice(open, missed, tuning)).toBe(
      lines.ore.missed.replaceAll("{amount}", String(demand.amount)),
    );
  });

  test("nothing is reported before promotion or when the crown stays quiet", () => {
    expect(crownNotice(null, crown(null), tuning)).toBeNull();
    expect(crownNotice(crown(null), crown(null), tuning)).toBeNull();
  });
});
