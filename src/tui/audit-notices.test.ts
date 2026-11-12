import { describe, expect, test } from "bun:test";
import { noticeFrame, tuning, viewWith } from "../../test/helpers";
import { copy } from "../core/copy";
import type { GameView } from "../core/view";
import { auditNotice } from "./audit-notices";
import { formatTicksRoughly } from "./format";

const books = (
  auditInTicks: number | null,
  onTheRoad = auditInTicks !== null,
): GameView =>
  viewWith({
    illusion: {
      books: "strained",
      room: 100,
      debt: {},
      debtIsExact: false,
      auditOnTheRoad: onTheRoad,
      auditInTicks,
    },
  });
const warning = tuning.illusion.audit.warningTicks;

describe("auditNotice", () => {
  test("auditors setting out are announced once, with roughly how long they will take, and never when none are on the road, before conjuring or already on the road at load", () => {
    const setOut = auditNotice(books(null), books(warning), noticeFrame);

    expect(setOut).toBe(
      copy.notices.auditorsOnTheRoad({
        wait: formatTicksRoughly(warning, tuning.stepMs),
      }),
    );
    expect(
      auditNotice(books(warning), books(warning - 1), noticeFrame),
    ).toBeNull();
    expect(auditNotice(books(null), books(null), noticeFrame)).toBeNull();
    expect(
      auditNotice(viewWith({ illusion: null }), books(warning), noticeFrame),
    ).toBeNull();
    expect(auditNotice(books(warning), books(null), noticeFrame)).toBeNull();
  });

  test("auditors setting out are announced without a time when the wait is not known", () => {
    const notice = auditNotice(books(null), books(null, true), noticeFrame);

    expect(notice).toBe(copy.notices.auditorsOnTheRoadUnknownWait);
  });
});
