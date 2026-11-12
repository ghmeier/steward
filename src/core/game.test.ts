import { describe, expect, test } from "bun:test";
import { fullTuningJson, quietOptions, tuning } from "../../test/helpers";
import { Game } from "./game";
import { seedStream } from "./rng";
import { RNG_STREAMS, SCHEMA_VERSION } from "./state";
import { parseTuning } from "./tuning";
import { validateState } from "./validate";

describe("Game.create", () => {
  test("is deterministic, valid, and starts with the tuned resources and an idle village", () => {
    const { state } = Game.create(7, tuning);

    expect(Game.create(7, tuning).state).toEqual(state);
    expect(validateState(state)).toEqual([]);
    expect(state.schemaVersion).toBe(SCHEMA_VERSION);
    expect(state.tick).toBe(0);
    expect(state.posting.resources).toEqual(tuning.economy.initialResources);
    expect(state.posting.economy).toEqual({
      famine: { startPopulation: 0, ticks: 0, deaths: 0 },
      growth: 0,
      starved: 0,
    });
    expect(Object.keys(state.posting.rng)).toEqual([...RNG_STREAMS]);
    expect(state.posting.nextDelegateId).toBe(
      tuning.economy.initialPopulation + 1,
    );
  });

  test("seeds every stream from the seed and its name when nobody is born", () => {
    const empty = {
      ...tuning,
      economy: { ...tuning.economy, initialPopulation: 0 },
    };

    const { state } = Game.create(7, empty);

    // The disputes stream has already drawn the first arrival delay.
    for (const name of RNG_STREAMS.filter((name) => name !== "disputes")) {
      expect(state.posting.rng[name]).toEqual(seedStream(7, name));
    }
  });

  test.each([
    [0, true],
    [0xffffffff, true],
    [-1, false],
    [1.5, false],
    [0x100000000, false],
    [Number.NaN, false],
  ])("seed %p is accepted only if it is a uint32: %p", (seed, accepted) => {
    const create = () => Game.create(seed, tuning);

    if (accepted) expect(create).not.toThrow();
    else expect(create).toThrow();
  });
});

describe("Game.fromState and clone", () => {
  test("fromState wraps the given state without drawing from any random stream", () => {
    const source = Game.create(7, tuning);
    const before = structuredClone(source.state);

    const wrapped = Game.fromState(source.state, tuning);

    expect(wrapped.state).toBe(source.state);
    expect(wrapped.state).toEqual(before);
  });

  test("clone copies the state deeply so stepping the copy leaves the original untouched", () => {
    const game = Game.create(7, tuning);
    const before = structuredClone(game.state);

    const copy = game.clone();
    copy.steps.runSteps(5, [], quietOptions);

    expect(copy.state).not.toBe(game.state);
    expect(copy.state.tick).toBe(5);
    expect(game.state).toEqual(before);
  });

  test("validate passes for a fresh game and throws for a corrupted one", () => {
    const game = Game.create(7, tuning);
    expect(() => game.validate()).not.toThrow();

    game.state.posting.resources.grain = Number.NaN;

    expect(() => game.validate()).toThrow("invalid game state");
  });
});

describe("parseTuning", () => {
  test("accepts data/tuning.json unchanged", () => {
    expect(parseTuning(fullTuningJson) as unknown).toEqual(fullTuningJson);
  });

  const t = fullTuningJson;
  const [firstDispute] = t.desk.kinds.dispute.templates;
  const expiryIndex =
    firstDispute?.options.findIndex(
      (option) => option.id === firstDispute.expiry,
    ) ?? -1;
  const entries = t.archive.entries;
  const without = (id: string) => entries.filter((entry) => entry.id !== id);

  // Each row sets one dotted path in a copy of the shipped tuning JSON.
  // biome-ignore format: one row per case
  const crossFieldRejections: [string, string, unknown, string][] = [
		["initial population above the maximum", "economy.initialPopulation", t.economy.maxPopulation + 1, "tuning.economy.initialPopulation: must not exceed"],
		["allocation shares that do not sum to 1", "economy.laborAllocations", { odd: { farm: 0.5, forest: 0.5, mine: 0.5 } }, "tuning.economy.laborAllocations.odd: shares must sum to 1"],
		["fewer names than the maximum population", "village.names", t.village.names.slice(0, t.economy.maxPopulation - 1), "tuning.village.names: needs at least"],
		["a repeated name", "village.names.5", t.village.names[2], "tuning.village.names: repeats"],
		["a promotion population above the maximum", "village.promotionPopulation", t.economy.maxPopulation + 1, "tuning.village.promotionPopulation: must not exceed"],
		["minTicks above maxTicks", "desk.arrival", { minTicks: 20, maxTicks: 10 }, "tuning.desk.arrival.minTicks: must not exceed"],
		["a repeated dispute id", "desk.kinds.dispute.templates.1.id", firstDispute?.id, "tuning.desk.kinds.dispute.templates: repeats id"],
		["a repeated option id", "desk.kinds.dispute.templates.0.options.1.id", firstDispute?.options[0]?.id, "tuning.desk.kinds.dispute.templates[0].options: repeats option id"],
		["an expiry naming no option", "desk.kinds.dispute.templates.0.expiry", "nothing", "tuning.desk.kinds.dispute.templates[0].expiry: must name one of its options"],
		["an unknown placeholder", "desk.kinds.dispute.templates.0.text", "{third} waits", "tuning.desk.kinds.dispute.templates[0].text: has unknown placeholder"],
		["an expiry option that grudges", `desk.kinds.dispute.templates.0.options.${expiryIndex}.grudge`, "first", "must not grudge"],
		["an expiry option that gains a resource", `desk.kinds.dispute.templates.0.options.${expiryIndex}.resources`, { coin: 1 }, "must not gain coin"],
		["a merchant text with a party placeholder", "desk.kinds.merchant.templates.0.text", "{first} waits", "tuning.desk.kinds.merchant.templates[0].text: has unknown placeholder"],
		["a merchant option that grudges", "desk.kinds.merchant.templates.0.options.0.grudge", "first", "Unrecognized key"],
		["a dispute option that adds a peasant", "desk.kinds.dispute.templates.0.options.0.newcomer", true, "Unrecognized key"],
		["an expiry option that adds a peasant", "desk.kinds.traveller.templates.0.options.1.newcomer", true, "must not add a peasant"],
		["a zero arrival weight", "desk.kinds.traveller.weight", 0, "tuning.desk.kinds.traveller.weight"],
		["no compound conditions entry", "archive.entries", without("decree.compound"), 'tuning.archive.entries: must include "decree.compound"'],
		["no chaining entry", "archive.entries", without("decree.chaining"), 'tuning.archive.entries: must include "decree.chaining"'],
		["a duplicate id across entries", "archive.entries.1.id", entries[0]?.id, "tuning.archive: repeats id"],
		["a requires naming an unknown id", "archive.entries.0.requires", ["control.nothing"], 'requires unknown id "control.nothing"'],
		["a requires cycle", "archive.entries.3.requires", ["control.savedDecrees"], "tuning.archive.entries: requires cycle"],
		["no Archive panel play unlock", "archive.play", [], "tuning.archive.play: must include"],
	];

  test.each(crossFieldRejections)(
    "rejects %s",
    (_name, path, value, fragment) => {
      const json = structuredClone(fullTuningJson);
      const keys = path.split(".");
      const last = keys.pop() as string;
      // biome-ignore lint/suspicious/noExplicitAny: the table walks arbitrary JSON paths
      let node: any = json;
      for (const key of keys) node = node[key];
      node[last] = value;

      expect(() => parseTuning(json)).toThrow(fragment);
    },
  );
});
