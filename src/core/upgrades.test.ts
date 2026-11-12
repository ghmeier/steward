import { describe, expect, test } from "bun:test";
import {
  addGovernors,
  contextFor,
  fullTuningJson,
  governorOf,
  grantUnlocks,
  setRoster,
  tuning,
} from "../../test/helpers";
import { Game } from "./game";
import { Job } from "./realm";
import { parseTuning } from "./tuning";
import { type ArchiveEntry, MODIFIERS, type ModifierId } from "./unlocks";

function entry(id: string): ArchiveEntry {
  const found = tuning.archive.entries.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no archive entry ${id}`);
  return found;
}

function effectOf(id: string, modifier: ModifierId): number {
  const value = entry(id).effects?.[modifier];
  if (value === undefined) throw new Error(`${id} does not change ${modifier}`);
  return value;
}

function villageOwning(...ids: string[]): Game {
  const game = Game.create(1, tuning);
  grantUnlocks(game, ids);
  return game;
}

describe("modifier", () => {
  test("a factor is the product of the owned entries and a gap is their sum", () => {
    const game = villageOwning(
      "tools.plough1",
      "tools.plough2",
      "store.granary1",
    );

    expect(game.unlocks.modifier("farmYield")).toBe(
      effectOf("tools.plough1", "farmYield") *
        effectOf("tools.plough2", "farmYield"),
    );
    expect(game.unlocks.modifier("grainCap")).toBe(
      effectOf("store.granary1", "grainCap"),
    );
  });

  test("with nothing owned a factor is one and a gap is zero", () => {
    const game = villageOwning();

    const factors = Object.entries(MODIFIERS).filter(
      ([, kind]) => kind === "factor",
    );
    const gaps = Object.entries(MODIFIERS).filter(([, kind]) => kind === "gap");
    expect(factors.length).toBeGreaterThan(0);
    for (const [id] of factors) {
      expect(game.unlocks.modifier(id as ModifierId)).toBe(1);
    }
    for (const [id] of gaps) {
      expect(game.unlocks.modifier(id as ModifierId)).toBe(0);
    }
  });

  test("an entry that is not owned changes nothing even if it has been seen", () => {
    const game = Game.create(1, tuning);
    game.state.career.seen["tools.plough1"] = 0;

    expect(game.unlocks.modifier("farmYield")).toBe(1);
  });

  test("the tuning rejects an entry that changes a modifier no manager reads", () => {
    const json = structuredClone(fullTuningJson);
    const first = json.archive.entries[0] as { effects?: object };
    first.effects = { luck: 2 };

    expect(() => parseTuning(json)).toThrow('unknown modifier "luck"');
  });

  test("the tuning rejects an effect that is not a positive number", () => {
    const json = structuredClone(fullTuningJson);
    const first = json.archive.entries[0] as { effects?: object };
    first.effects = { grainCap: 0 };

    expect(() => parseTuning(json)).toThrow();
  });
});

describe("each manager's getter reflects an owned upgrade", () => {
  const rows: {
    name: string;
    entry: string;
    modifier: ModifierId;
    read: (game: Game) => number;
    base: number;
    combine: (base: number, effect: number) => number;
  }[] = [
    {
      name: "grain cap",
      entry: "store.granary1",
      modifier: "grainCap",
      read: (game) => game.economy.capOf("grain"),
      base: tuning.economy.caps.grain,
      combine: (base, effect) => base + effect,
    },
    {
      name: "wood cap",
      entry: "store.woodshed1",
      modifier: "woodCap",
      read: (game) => game.economy.capOf("wood"),
      base: tuning.economy.caps.wood,
      combine: (base, effect) => base + effect,
    },
    {
      name: "ore cap",
      entry: "store.oreStore1",
      modifier: "oreCap",
      read: (game) => game.economy.capOf("ore"),
      base: tuning.economy.caps.ore,
      combine: (base, effect) => base + effect,
    },
    {
      name: "grain per farmer",
      entry: "tools.plough1",
      modifier: "farmYield",
      read: (game) => game.economy.grainPerFarmer,
      base: tuning.economy.grainPerFarmer,
      combine: (base, effect) => base * effect,
    },
    {
      name: "wood per worker",
      entry: "tools.axes1",
      modifier: "forestYield",
      read: (game) => game.economy.woodPerWorker,
      base: tuning.economy.woodPerWorker,
      combine: (base, effect) => base * effect,
    },
    {
      name: "ore per worker",
      entry: "tools.picks1",
      modifier: "mineYield",
      read: (game) => game.economy.orePerWorker,
      base: tuning.economy.orePerWorker,
      combine: (base, effect) => base * effect,
    },
    {
      name: "sell price",
      entry: "market.rights",
      modifier: "sellPrice",
      read: (game) => game.economy.priceOf("wood"),
      base: tuning.economy.woodPrice,
      combine: (base, effect) => base * effect,
    },
    {
      name: "interest per season",
      entry: "lenders.favor",
      modifier: "interest",
      read: (game) => game.illusion.interestPerSeason,
      base: tuning.illusion.interestPerSeason,
      combine: (base, effect) => base * effect,
    },
    {
      name: "audit gap",
      entry: "court.friends",
      modifier: "auditGap",
      read: (game) => game.illusion.auditGapTicks,
      base: tuning.illusion.audit.minGapTicks,
      combine: (base, effect) => base + effect,
    },
    {
      name: "governor deaths",
      entry: "governors.physician",
      modifier: "governorDeath",
      read: (game) => game.governors.deathPerMille,
      base: tuning.governors.deathPerMille,
      combine: (base, effect) => Math.round(base * effect),
    },
    {
      name: "governor slots",
      entry: "governors.slots",
      modifier: "governorSlots",
      read: (game) => game.governors.cap,
      base: tuning.governors.cap,
      combine: (base, effect) => base + effect,
    },
  ];

  test.each(rows)("$name", ({ entry: id, modifier, read, base, combine }) => {
    const before = read(villageOwning());

    const after = read(villageOwning(id));

    expect(before).toBe(base);
    expect(after).toBe(combine(base, effectOf(id, modifier)));
  });

  test("the wood yield an upgrade raises is the one a governor's output is built on", () => {
    const game = villageOwning("tools.axes1");
    const [governor] = addGovernors(game, governorOf({ job: Job.FOREST }));

    const output = game.governors.realOutput(governor as never, 1);

    expect(output).toBe(
      game.governors.workersOf(governor as never) * game.economy.woodPerWorker,
    );
  });
});

describe("stockpile caps", () => {
  const woodCap = (game: Game) => game.economy.capOf("wood");

  function cuttingWood(game: Game, stock: number): number {
    setRoster(game, { forest: 1 });
    game.state.posting.resources.wood = stock;
    game.economy.run(contextFor(game));
    return game.state.posting.resources.wood ?? 0;
  }

  test("production stops at the cap and the excess is lost", () => {
    const game = Game.create(1, tuning);

    const wood = cuttingWood(
      game,
      woodCap(game) - game.economy.woodPerWorker / 2,
    );

    expect(wood).toBe(woodCap(game));
  });

  test("an upgrade that raises the cap lets production continue past the old one", () => {
    const game = villageOwning("store.woodshed1");
    const oldCap = tuning.economy.caps.wood;

    const wood = cuttingWood(game, oldCap);

    expect(wood).toBeGreaterThan(oldCap);
    expect(wood).toBeLessThanOrEqual(woodCap(game));
  });

  test("stock already above the cap is kept, neither trimmed nor grown", () => {
    const game = Game.create(1, tuning);
    const over = woodCap(game) + 50;

    const wood = cuttingWood(game, over);

    expect(wood).toBe(over);
  });

  test("coin has no cap", () => {
    const game = Game.create(1, tuning);

    expect(game.economy.capOf("coin")).toBe(Number.POSITIVE_INFINITY);
  });

  test("a full granary loses only the harvest, not what the village eats", () => {
    const game = Game.create(1, tuning);
    setRoster(game, { farm: 1 });
    game.state.tick = 1;
    game.state.posting.resources.grain = game.economy.capOf("grain");

    game.economy.run(contextFor(game));

    expect(game.state.posting.resources.grain).toBe(
      game.economy.capOf("grain"),
    );
  });
});

describe("tiers appear progressively", () => {
  function seenAfter(game: Game): string[] {
    game.unlocks.run();
    return tuning.archive.entries
      .map(({ id }) => id)
      .filter((id) => game.unlocks.isSeen(id));
  }

  test("a stock-gated upgrade appears once its stock passes the threshold and not before", () => {
    const threshold = (entry("store.granary1").shown as { value: number })
      .value;
    const game = Game.create(1, tuning);

    game.state.posting.resources.grain = threshold;
    const atThreshold = seenAfter(game);
    game.state.posting.resources.grain = threshold + 1;
    const above = seenAfter(game);

    expect(atThreshold).not.toContain("store.granary1");
    expect(above).toContain("store.granary1");
  });

  test("a second tier is not offered until the first is owned and the charter is bought", () => {
    const game = villageOwning();
    game.state.career.seen["store.granary2"] = 0;
    const second = entry("store.granary2");

    const bare = game.unlocks.isOffered(second);
    grantUnlocks(game, ["store.granary1"]);
    const withoutCharter = game.unlocks.isOffered(second);
    grantUnlocks(game, ["panel.crown"]);

    expect(bare).toBe(false);
    expect(withoutCharter).toBe(false);
    expect(game.unlocks.isOffered(second)).toBe(true);
  });

  test("upgrades for after a governor serves stay hidden until one is hired", () => {
    const game = Game.create(1, tuning);
    const hiredOnly = tuning.archive.entries
      .filter(({ shown }) => shown === "governor")
      .map(({ id }) => id);

    const before = seenAfter(game);
    addGovernors(game, governorOf());
    const after = seenAfter(game);

    expect(hiredOnly.length).toBeGreaterThan(0);
    for (const id of hiredOnly) {
      expect(before).not.toContain(id);
      expect(after).toContain(id);
    }
  });

  test("the charter tier is not offered before the charter, whatever the stock", () => {
    const game = Game.create(1, tuning);
    Object.assign(game.state.posting.resources, {
      grain: 1e4,
      wood: 1e4,
      ore: 1e4,
    });
    game.state.career.promotedAt = 1;
    game.unlocks.run();
    const charterTier = tuning.archive.entries.filter(({ requires }) =>
      requires.includes("panel.crown"),
    );

    const before = charterTier.filter((e) => game.unlocks.isOffered(e));

    expect(charterTier.length).toBeGreaterThan(0);
    expect(before).toEqual([]);
  });

  test("every upgrade costs some wood or ore, so those resources have a use", () => {
    const upgrades = tuning.archive.entries.filter(
      ({ effects, id }) => effects !== undefined || id.startsWith("court."),
    );

    for (const { cost } of upgrades) {
      expect((cost.wood ?? 0) + (cost.ore ?? 0)).toBeGreaterThan(0);
    }
  });
});
