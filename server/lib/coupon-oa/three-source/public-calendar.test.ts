import { describe, expect, it } from "vitest";
import {
  findMonthDayWindowInTexts,
  mergeCampaignThemeCandidates,
  type PublicCampaignCandidate,
  resolveMissingYearCandidate,
} from "./public-calendar";

const calendar: PublicCampaignCandidate[] = [
  {
    name: "双十一大促",
    startDate: "2026-11-01",
    endDate: "2026-11-11",
    sourceUrl: "https://calendar.example/double-11",
    fetchedAt: "2026-10-12T00:00:00.000Z",
  },
];

describe("public campaign calendar inference", () => {
  it("finds a month-day window without exposing other workbook content", () => {
    expect(
      findMonthDayWindowInTexts(["说明", "活动期为9月30日—10月10日"]),
    ).toEqual({ startMonthDay: "09-30", endMonthDay: "10-10" });
  });
  it("keeps an explicit year as a source fact", () => {
    expect(
      resolveMissingYearCandidate({
        startMonthDay: "09-30",
        endMonthDay: "10-10",
        explicitYear: 2027,
        now: "2026-10-12",
      }),
    ).toMatchObject({
      startDate: "2027-09-30",
      endDate: "2027-10-10",
      origin: "source_explicit",
      needsOwnerConfirmation: false,
    });
  });

  it("infers a missing year but requires owner confirmation", () => {
    expect(
      resolveMissingYearCandidate({
        startMonthDay: "09-30",
        endMonthDay: "10-10",
        now: "2026-10-12",
      }),
    ).toMatchObject({
      startDate: "2026-09-30",
      endDate: "2026-10-10",
      origin: "ai_inferred",
      needsOwnerConfirmation: true,
    });
  });

  it("handles cross-year windows and rejects conflicting years", () => {
    expect(
      resolveMissingYearCandidate({
        startMonthDay: "12-20",
        endMonthDay: "01-05",
        now: "2026-10-12",
      }),
    ).toMatchObject({ startDate: "2026-12-20", endDate: "2027-01-05" });
    expect(
      resolveMissingYearCandidate({
        startMonthDay: "09-30",
        endMonthDay: "10-10",
        now: "2026-10-12",
        revisionYears: [2026, 2027],
      }),
    ).toMatchObject({ status: "ambiguous", needsOwnerConfirmation: true });
  });

  it("uses overlapping calendar entries only as inferred themes", () => {
    expect(
      mergeCampaignThemeCandidates({
        calendarCandidates: calendar,
        startDate: "2026-11-05",
        endDate: "2026-11-10",
      }),
    ).toEqual([
      {
        value: "双十一大促",
        origin: "ai_inferred",
        sourceUrl: "https://calendar.example/double-11",
      },
    ]);
  });
});
