import { describe, expect, test } from "bun:test";
import { tuning } from "../../test/helpers";
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

    expect(crownNotice(before, crossing, tuning)).toContain("One season left");
    expect(
      crownNotice(crossing, crown({ ticksLeft: season - 1 }), tuning),
    ).toBeNull();
  });

  test("a demand met reports the met line with the full amount", () => {
    const open = crown({ delivered: 70, ticksLeft: 5 });
    const met = crown(null, { met: 1 });

    expect(crownNotice(open, met, tuning)).toBe(
      lines.ore.met.replaceAll("{amount}", String(demand.amount)),
    );
  });

  test("a demand missed reports the missed line with the amount still unpaid", () => {
    const open = crown({ delivered: 30, ticksLeft: 5 });
    const missed = crown(null, { missed: 1 });

    expect(crownNotice(open, missed, tuning)).toBe(
      lines.ore.missed.replaceAll("{amount}", String(demand.amount - 30)),
    );
  });

  test("nothing is reported before promotion or when the crown stays quiet", () => {
    expect(crownNotice(null, crown(null), tuning)).toBeNull();
    expect(crownNotice(crown(null), crown(null), tuning)).toBeNull();
  });
});
