import { describe, expect, test } from "bun:test";
import { tuning } from "../../test/helpers";
import type { IllusionView } from "../core/view";
import { auditNotice } from "./audit-notices";
import { formatTicksRoughly } from "./format";

const books = (auditInTicks: number | null): IllusionView => ({
  books: "strained",
  room: 100,
  auditInTicks,
});
const warning = tuning.illusion.audit.warningTicks;

describe("auditNotice", () => {
  test("auditors setting out are announced once, with roughly how long they will take", () => {
    const setOut = auditNotice(books(null), books(warning), tuning);
    const nextFrame = auditNotice(books(warning), books(warning - 1), tuning);

    expect(setOut).toContain("Auditors are on the road");
    expect(setOut).toContain(formatTicksRoughly(warning, tuning.stepMs));
    expect(nextFrame).toBeNull();
  });

  test("nothing is announced with no auditors, before conjuring, or when they are already on the road at load", () => {
    expect(auditNotice(books(null), books(null), tuning)).toBeNull();
    expect(auditNotice(null, books(warning), tuning)).toBeNull();
    expect(auditNotice(books(warning), books(null), tuning)).toBeNull();
  });
});
