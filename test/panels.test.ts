import { afterEach, describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import type { GameView } from "../src/core/view";
import { formatAmount, formatGameTime, formatRate } from "../src/tui/format";
import { createPanels } from "../src/tui/panels";

type Setup = Awaited<ReturnType<typeof createTestRenderer>>;
const setups: Setup[] = [];

afterEach(async () => {
	for (const setup of setups.splice(0)) await setup.dispose();
});

async function draw(
	views: GameView[],
	footer: string,
	size = { width: 100, height: 30 },
	selectedId: number | null = null,
) {
	const setup = await createTestRenderer({ ...size, exitOnCtrlC: false });
	setups.push(setup);
	const panels = createPanels(setup.renderer);
	let frame = "";
	for (const view of views) {
		panels.update(view, footer, selectedId);
		await setup.renderOnce();
		frame = setup.captureCharFrame();
	}
	return frame;
}

function emptyView(overrides: Partial<GameView> = {}): GameView {
	return {
		tick: 0,
		elapsedSeconds: 0,
		ledger: [],
		realm: {
			population: 10,
			idle: 10,
			labor: { farm: 0, forest: 0, mine: 0 },
			season: "spring",
			starved: 0,
		},
		delegates: [],
		decrees: [],
		desk: [],
		governors: [],
		crown: null,
		promotion: { target: 20, promotedAt: 0, promotedAtSeconds: 0 },
		growth: { stored: 0, needed: 25, perSecond: 0, full: false },
		lockedPanels: [],
		unlocks: [],
		archive: { open: false, entries: [] },
		...overrides,
	};
}

describe("createPanels layout", () => {
	for (const size of [
		{ width: 100, height: 30 },
		{ width: 80, height: 24 },
	]) {
		test(`shows all four titles and the footer at ${size.width}x${size.height}`, async () => {
			const frame = await draw([emptyView()], "q quit  space pause", size);

			for (const title of ["Ledger", "Crown", "Desk", "Peasants"]) {
				expect(frame).toContain(title);
			}
			expect(frame).toContain("q quit  space pause");
		});
	}
});

describe("createPanels ledger", () => {
	test("shows each resource name, amount, rate and the game time", async () => {
		const view = emptyView({
			elapsedSeconds: 185,
			ledger: [
				{ resource: "grain", amount: 1234.5, ratePerSecond: 15 },
				{ resource: "wood", amount: 2_500_000, ratePerSecond: -2.5 },
			],
		});

		const frame = await draw([view], "");

		expect(frame).toContain(`Time  ${formatGameTime(view.elapsedSeconds)}`);
		for (const line of view.ledger) {
			const name =
				line.resource.charAt(0).toUpperCase() + line.resource.slice(1);
			expect(frame).toContain(name);
			expect(frame).toContain(formatAmount(line.amount));
			expect(frame).toContain(formatRate(line.ratePerSecond));
		}
	});

	test("aligns amounts and rates in shared columns", async () => {
		const view = emptyView({
			ledger: [
				{ resource: "grain", amount: 5, ratePerSecond: 1 },
				{ resource: "timber", amount: 1234567.8, ratePerSecond: -22.5 },
			],
		});

		const frame = await draw([view], "");

		const lines = frame.split("\n");
		const grain = lines.find((l) => l.includes("Grain")) ?? "";
		const timber = lines.find((l) => l.includes("Timber")) ?? "";
		const endOf = (line: string, text: string) =>
			line.indexOf(text) + text.length;
		expect(endOf(grain, formatAmount(5))).toBe(
			endOf(timber, formatAmount(1234567.8)),
		);
		expect(endOf(grain, formatRate(1))).toBe(endOf(timber, formatRate(-22.5)));
	});

	test("shows the realm lines under the resources, aligned with the resource names", async () => {
		const view = emptyView({
			ledger: [{ resource: "grain", amount: 5, ratePerSecond: 1 }],
			realm: {
				population: 12,
				idle: 5,
				labor: { farm: 4, forest: 2, mine: 1 },
				season: "summer",
				starved: 0,
			},
		});

		const frame = await draw([view], "");

		expect(frame).toContain("Population  12 (5 idle)");
		expect(frame).toContain("Farm 4  Forest 2  Mine 1");
		expect(frame).toContain("Season  Summer");
		const lines = frame.split("\n");
		const column = (text: string) =>
			(lines.find((l) => l.includes(text)) ?? "").indexOf(text);
		expect(column("Population")).toBe(column("Grain"));
		expect(column("Season")).toBe(column("Grain"));
	});

	test("replaces old values when updated with a new view", async () => {
		const first = emptyView({
			ledger: [{ resource: "grain", amount: 111, ratePerSecond: 1 }],
		});
		const second = emptyView({
			ledger: [{ resource: "grain", amount: 222_222, ratePerSecond: 1 }],
		});

		const frame = await draw([first, second], "");

		expect(frame).not.toContain(formatAmount(111));
		expect(frame).toContain(formatAmount(222_222));
	});
});

describe("createPanels placeholders", () => {
	test("shows placeholders when the crown, desk and peasants are empty", async () => {
		const frame = await draw([emptyView()], "");

		expect(frame).toContain("The crown demands nothing, for now.");
		expect(frame).toContain("The desk is clear.");
	});

	test("shows entries instead of placeholders when present", async () => {
		const view = emptyView({
			crown: { label: "Tribute due" },
			desk: [
				{
					id: 1,
					label: "Sign the decree",
					parties: ["Ada", "Bram"],
					options: [],
				},
			],
			delegates: [{ id: 3, name: "Ada", job: "farm", grudgeTicks: 0 }],
		});

		const frame = await draw([view], "");

		expect(frame).toContain("Tribute due");
		expect(frame).toContain("Sign the decree");
		expect(frame).toContain("Ada");
		expect(frame).not.toContain("The crown demands nothing");
		expect(frame).not.toContain("The desk is clear.");
	});
});

describe("createPanels empty village", () => {
	const emptyVillage = "The village is empty. Press n to found a new one.";

	test("an empty roster says the village is empty and how to start again", async () => {
		const view = emptyView({
			realm: { ...emptyView().realm, population: 0, idle: 0 },
		});

		const frame = await draw([view], "", { width: 160, height: 30 });

		expect(frame).toContain(emptyVillage);
	});

	test("a village with peasants lists them instead of the empty line", async () => {
		const view = emptyView({
			delegates: [{ id: 3, name: "Ada", job: "farm", grudgeTicks: 0 }],
		});

		const frame = await draw([view], "");

		expect(frame).toContain("Ada");
		expect(frame).not.toContain(emptyVillage);
	});
});

describe("createPanels peasants", () => {
	const view = emptyView({
		delegates: [
			{ id: 1, name: "Ada", job: "farm", grudgeTicks: 0 },
			{ id: 2, name: "Bram", job: "idle", grudgeTicks: 30 },
		],
	});

	test("lists each peasant with a job, a cursor on the selected row and a grudge marker", async () => {
		const frame = await draw([view], "", undefined, 2);

		expect(frame).toMatch(/ {2}Ada {2}farm/);
		expect(frame).toMatch(/> Bram {2}idle \(grudge\)/);
		expect(frame).not.toMatch(/> Ada/);
	});
});

describe("createPanels locked panels", () => {
	test("a locked panel keeps its title but reads Locked. in place of its content", async () => {
		const view = emptyView({
			lockedPanels: ["crown"],
			crown: { label: "Tribute due" },
		});

		const frame = await draw([view], "");

		expect(frame).toContain("Crown");
		expect(frame).toContain("Locked.");
		expect(frame).not.toContain("Tribute due");
		expect(frame).not.toContain("The crown demands nothing");
	});

	test("panels that are not locked show their content", async () => {
		const frame = await draw([emptyView()], "");

		expect(frame).not.toContain("Locked.");
		expect(frame).toContain("The crown demands nothing, for now.");
	});
});

describe("createPanels promotion", () => {
	test("before promotion the ledger shows progress toward the target", async () => {
		const view = emptyView({
			promotion: { target: 20, promotedAt: 0, promotedAtSeconds: 0 },
			realm: {
				population: 14,
				idle: 0,
				labor: { farm: 14, forest: 0, mine: 0 },
				season: "spring",
				starved: 0,
			},
		});

		const frame = await draw([view], "");

		expect(frame).toContain("Promotion  14 / 20 peasants");
		expect(frame).not.toContain("Promoted to steward");
	});

	test("after promotion the ledger names the game time of the promotion", async () => {
		const view = emptyView({
			promotion: { target: 20, promotedAt: 1200, promotedAtSeconds: 120 },
		});

		const frame = await draw([view], "");

		expect(frame).toContain(`Promoted to steward on ${formatGameTime(120)}`);
		expect(frame).not.toContain("Promotion  ");
	});
});

describe("createPanels next peasant", () => {
	test("a feeding village shows progress and the time to the next peasant", async () => {
		const growth = { stored: 12.4, needed: 25, perSecond: 0.5, full: false };

		const frame = await draw([emptyView({ growth })], "");

		expect(frame).toContain("Next peasant  12.4 / 25 grain  (~26s)");
	});

	test("a village that is not feeding shows the grain with no estimate", async () => {
		const growth = { stored: 12.4, needed: 25, perSecond: 0, full: false };

		const frame = await draw([emptyView({ growth })], "");

		expect(frame).toContain("Next peasant  12.4 / 25 grain");
		expect(frame).not.toContain("12.4 / 25 grain  (");
	});

	test("a full village shows no next peasant line", async () => {
		const growth = { stored: 3, needed: 25, perSecond: 0.5, full: true };

		const frame = await draw([emptyView({ growth })], "");

		expect(frame).not.toContain("Next peasant");
	});
});

describe("createPanels desk hint", () => {
	test("the court hint appears when a dispute waits", async () => {
		const view = emptyView({
			desk: [
				{ id: 1, label: "A squabble", parties: ["Ada", "Bram"], options: [] },
			],
		});

		const frame = await draw([view], "");

		expect(frame).toContain("A squabble");
		expect(frame).toContain("Press c to hold court.");
	});

	test("the court hint is absent when the desk is clear", async () => {
		const frame = await draw([emptyView()], "");

		expect(frame).toContain("The desk is clear.");
		expect(frame).not.toContain("Press c to hold court.");
	});
});

describe("createPanels peasant scrolling", () => {
	const crowd = emptyView({
		delegates: Array.from({ length: 40 }, (_, index) => ({
			id: index + 1,
			name: `Peasant${index + 1}`,
			job: "idle" as const,
			grudgeTicks: 0,
		})),
	});

	test("a selected peasant far down the list is drawn with the hidden counts", async () => {
		const frame = await draw([crowd], "", { width: 100, height: 30 }, 30);

		expect(frame).toContain("> Peasant30  idle");
		expect(frame).toMatch(/↑ \d+ more/);
		expect(frame).toMatch(/↓ \d+ more/);
	});

	test("the first peasant shows no above-line", async () => {
		const frame = await draw([crowd], "", { width: 100, height: 30 }, 1);

		expect(frame).toContain("> Peasant1  idle");
		expect(frame).not.toContain("↑");
		expect(frame).toMatch(/↓ \d+ more/);
	});
});
