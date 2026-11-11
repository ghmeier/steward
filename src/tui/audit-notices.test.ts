import { describe, expect, test } from "bun:test";
import { tuning } from "../../test/helpers";
import { copy } from "../core/copy";
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
  test("auditors setting out are announced once, with roughly how long they will take, and never when none are on the road, before conjuring or already on the road at load", () => {
    const setOut = auditNotice(books(null), books(warning), tuning);

    expect(setOut).toBe(
      copy.notices.auditorsOnTheRoad({
        wait: formatTicksRoughly(warning, tuning.stepMs),
      }),
    );
    expect(auditNotice(books(warning), books(warning - 1), tuning)).toBeNull();
    expect(auditNotice(books(null), books(null), tuning)).toBeNull();
    expect(auditNotice(null, books(warning), tuning)).toBeNull();
    expect(auditNotice(books(warning), books(null), tuning)).toBeNull();
  });
});
