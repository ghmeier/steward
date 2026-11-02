import { describe, expect, test } from "bun:test";
import { setRoster, tuning } from "../../test/helpers";
import { Game } from "./game";
import { assertValidState, validateState } from "./validate";

// biome-ignore lint/suspicious/noExplicitAny: the tests patch arbitrary state paths
type Tree = Record<string, any>;
type Patches = Record<string, unknown>;

// A patch value of undefined deletes the key and a function receives the current value.
function patched(patches: Patches = {}): Tree {
  const game = Game.create(5, tuning);
  setRoster(game, { idle: 4 });
  const { state } = game;
  state.tick = 50;
  state.posting.desk.nextDisputeId = 5;
  state.posting.desk.disputes = [
    { id: 1, template: "hen", parties: [1, 2], arrivedAt: 10 },
    { id: 3, template: "hen", parties: [3, 4], arrivedAt: 20 },
  ];
  const root = state as unknown as Tree;
  for (const [path, value] of Object.entries(patches)) {
    const keys = path.split(".");
    const last = keys.pop() as string;
    const node = keys.reduce((parent, key) => parent[key], root);
    if (value === undefined) delete node[last];
    else node[last] = typeof value === "function" ? value(node[last]) : value;
  }
  return root;
}

const granary = {
  id: "granary",
  petition: "harvest",
  rules: [],
  otherwise: "sell",
};
const chose = (decree: string, policy: string) => [
  { when: { kind: "chose", decree, policy }, policy: "sell" },
];
const cycle = {
  a: { ...granary, id: "a", rules: chose("b", "farming") },
  b: { id: "b", petition: "labor", rules: chose("a", "sell"), otherwise: "x" },
};

class Widget {
  size = 1;
}

describe("validateState", () => {
  test("a fresh game validates", () => {
    expect(validateState(patched())).toEqual([]);
  });

  test.each([
    ["undefined", undefined],
    ["null", null],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["negative zero", -0],
    ["a Map", new Map()],
    ["a Date", new Date(0)],
    ["a class instance", new Widget()],
    ["a function", () => 1],
  ])("plain data: rejects %s with its path", (_name, value) => {
    const state = patched();
    state.posting.resources.grain = value;

    const problems = validateState(state);

    expect(
      problems.some((p) => p.startsWith("$.posting.resources.grain")),
    ).toBe(true);
  });

  test("plain data: rejects an array hole and accepts a null-prototype object", () => {
    // biome-ignore lint/suspicious/noSparseArray: the hole is the point of the test
    const holed = patched({ "career.followers": ["a", , "c"] });
    const bare = patched({
      "career.unlocks": Object.assign(Object.create(null), { a: 1 }),
    });

    expect(validateState(holed).join("\n")).toContain("$.career.followers[1]");
    expect(validateState(bare)).toEqual([]);
  });

  const D = "$.posting.decrees";
  const rejected: [string, Patches, string][] = [
    [
      "a wrong schemaVersion",
      { schemaVersion: 99 },
      "$.schemaVersion: Invalid input: expected 8",
    ],
    [
      "an all-zero rng stream",
      { "posting.rng.toy": [0, 0, 0, 0] },
      "rng.toy: must not be all zero",
    ],
    [
      "a missing resource",
      { "posting.resources.wood": undefined },
      "resources.wood: is missing",
    ],
    [
      "a decree under another key",
      { "posting.decrees": { m: granary } },
      `${D}.m: id must equal its key`,
    ],
    [
      "a saved decree under another key",
      { "career.savedDecrees": { m: granary } },
      "savedDecrees.m: id must equal its key",
    ],
    [
      "a decree set with a cycle",
      { "posting.decrees": cycle },
      `${D}: decree cycle: a -> b -> a`,
    ],
    [
      "a harvest decree with another petition's policy",
      { "posting.decrees": { granary: { ...granary, otherwise: "tax" } } },
      `${D}: decree "granary": policy "tax" is not a harvest policy`,
    ],
    [
      "two decrees on one petition",
      { "posting.decrees": { granary, m: { ...granary, id: "m" } } },
      `${D}: decree "granary" already handles the harvest petition`,
    ],
    [
      "a promotedAt after the tick",
      { "career.promotedAt": 51 },
      "career.promotedAt: must not exceed tick",
    ],
    [
      "delegates out of id order",
      { "posting.delegates": (l: unknown[]) => [...l].reverse() },
      "delegates[1].id: ids must be strictly ascending",
    ],
    [
      "a delegate id at nextDelegateId",
      { "posting.nextDelegateId": 4 },
      "delegates[3].id: must be below nextDelegateId",
    ],
    [
      "two peasants with one name",
      { "posting.delegates.1.name": "x", "posting.delegates.0.name": "x" },
      'delegates[1].name: "x" is held by another peasant',
    ],
    [
      "a dispute id at nextDisputeId",
      { "posting.desk.disputes.1.id": 5 },
      "disputes[1].id: must be below nextDisputeId",
    ],
    [
      "dispute parties outside the roster",
      { "posting.desk.disputes.0.parties": [1, 99] },
      "disputes[0].parties:",
    ],
    [
      "identical dispute parties",
      { "posting.desk.disputes.0.parties": [1, 1] },
      "disputes[0].parties:",
    ],
    [
      "a dispute arriving after the tick",
      { "posting.desk.disputes.0.arrivedAt": 51 },
      "disputes[0].arrivedAt:",
    ],
  ];

  test.each(rejected)("cross-field: rejects %s", (_name, patches, expected) => {
    const problems = validateState(patched(patches));

    expect(problems.join("\n")).toContain(expected);
  });

  test("a decree under the wrong key hides the set check of a cycle beside it", () => {
    const state = patched({
      "posting.decrees": {
        ...cycle,
        m: { ...granary, petition: "ore" },
      },
    });

    const text = validateState(state).join("\n");

    expect(text).toContain(`${D}.m: id must equal its key`);
    expect(text).not.toContain("decree cycle");
  });

  test.each([
    ["a decree stored under its id", { "posting.decrees": { granary } }],
    [
      "a roster with gaps in the ids",
      {
        "posting.delegates": (l: unknown[]) => l.slice(1),
        "posting.desk.disputes": [],
      },
    ],
    ["a promotedAt equal to the tick", { "career.promotedAt": 50 }],
  ])("cross-field: accepts %s", (_name, patches) => {
    expect(validateState(patched(patches))).toEqual([]);
  });
});

describe("validateState condition nesting", () => {
  function decreeNestedBy(levels: number) {
    let when: Tree = { kind: "season", season: "winter" };
    for (let level = 1; level < levels; level++) {
      when = { kind: "not", condition: when };
    }
    return { ...granary, rules: [{ when, policy: "sell" }] };
  }

  test("rejects a pathologically deep condition with a message instead of overflowing the stack", () => {
    const state = patched({
      "posting.decrees": { granary: decreeNestedBy(10_000) },
    });

    const text = validateState(state).join("\n");

    expect(text).toContain("nests deeper than 64 levels");
  });

  test("accepts a condition nested exactly to the cap", () => {
    const state = patched({
      "posting.decrees": { granary: decreeNestedBy(64) },
    });

    expect(validateState(state)).toEqual([]);
  });
});

describe("assertValidState", () => {
  test("throws one error listing every problem", () => {
    const state = patched({ tick: -1, schemaVersion: 99 });

    expect(() => assertValidState(state)).toThrow(
      /\$\.tick[\s\S]*\$\.schemaVersion|\$\.schemaVersion[\s\S]*\$\.tick/,
    );
  });
});
