import { z } from "zod";
import type { CandidateOrigin } from "./types";

const monthDaySchema = z
  .string()
  .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);

export interface PublicCampaignCandidate {
  name: string;
  startDate: string;
  endDate: string;
  sourceUrl: string;
  fetchedAt: string;
}

export interface DateInferenceResult {
  status: "resolved" | "ambiguous" | "invalid";
  startDate?: string;
  endDate?: string;
  origin?: CandidateOrigin;
  needsOwnerConfirmation: boolean;
  reasons: string[];
}

export function findMonthDayWindowInTexts(
  texts: string[],
): { startMonthDay: string; endMonthDay: string } | undefined {
  for (const text of texts) {
    const chinese = text.match(
      /(\d{1,2})\s*月\s*(\d{1,2})\s*日?[\s\S]{0,40}?(\d{1,2})\s*月\s*(\d{1,2})\s*日?/,
    );
    const compact = text.match(
      /(\d{1,2})[./-](\d{1,2})[\s\S]{0,20}?(\d{1,2})[./-](\d{1,2})/,
    );
    const match = chinese ?? compact;
    if (!match) continue;
    const value = [match[1], match[2], match[3], match[4]].map((part) =>
      String(Number(part)).padStart(2, "0"),
    );
    const candidate = {
      startMonthDay: `${value[0]}-${value[1]}`,
      endMonthDay: `${value[2]}-${value[3]}`,
    };
    if (
      monthDaySchema.safeParse(candidate.startMonthDay).success &&
      monthDaySchema.safeParse(candidate.endMonthDay).success
    ) {
      return candidate;
    }
  }
  return undefined;
}

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function datesForYear(input: {
  startMonthDay: string;
  endMonthDay: string;
  startYear: number;
}): { startDate: string; endDate: string } | undefined {
  const startDate = `${input.startYear}-${input.startMonthDay}`;
  const crossesYear = input.startMonthDay > input.endMonthDay;
  const endDate = `${input.startYear + (crossesYear ? 1 : 0)}-${input.endMonthDay}`;
  return validIsoDate(startDate) && validIsoDate(endDate)
    ? { startDate, endDate }
    : undefined;
}

export function resolveMissingYearCandidate(input: {
  startMonthDay: string;
  endMonthDay: string;
  now: string;
  explicitYear?: number;
  revisionYears?: number[];
  calendarCandidates?: PublicCampaignCandidate[];
}): DateInferenceResult {
  if (
    !monthDaySchema.safeParse(input.startMonthDay).success ||
    !monthDaySchema.safeParse(input.endMonthDay).success ||
    !validIsoDate(input.now.slice(0, 10))
  ) {
    return {
      status: "invalid",
      needsOwnerConfirmation: true,
      reasons: ["日期格式无效"],
    };
  }
  if (input.explicitYear) {
    const resolved = datesForYear({
      startMonthDay: input.startMonthDay,
      endMonthDay: input.endMonthDay,
      startYear: input.explicitYear,
    });
    return resolved
      ? {
          status: "resolved",
          ...resolved,
          origin: "source_explicit",
          needsOwnerConfirmation: false,
          reasons: ["来源材料写明年份"],
        }
      : {
          status: "invalid",
          needsOwnerConfirmation: true,
          reasons: ["来源年份与月日不能组成有效日期"],
        };
  }
  const revisionYears = [...new Set(input.revisionYears ?? [])];
  if (revisionYears.length > 1) {
    return {
      status: "ambiguous",
      needsOwnerConfirmation: true,
      reasons: ["同一提报材料出现多个年份"],
    };
  }
  const calendarYears = [
    ...new Set(
      (input.calendarCandidates ?? [])
        .filter(
          (candidate) =>
            candidate.startDate.slice(5) === input.startMonthDay &&
            candidate.endDate.slice(5) === input.endMonthDay,
        )
        .map((candidate) => Number(candidate.startDate.slice(0, 4)))
        .filter(Number.isInteger),
    ),
  ];
  if (calendarYears.length > 1) {
    return {
      status: "ambiguous",
      needsOwnerConfirmation: true,
      reasons: ["公开活动日历存在多个可能年份"],
    };
  }
  const startYear =
    revisionYears[0] ?? calendarYears[0] ?? Number(input.now.slice(0, 4));
  const resolved = datesForYear({
    startMonthDay: input.startMonthDay,
    endMonthDay: input.endMonthDay,
    startYear,
  });
  if (!resolved) {
    return {
      status: "invalid",
      needsOwnerConfirmation: true,
      reasons: ["无法形成有效的完整日期"],
    };
  }
  return {
    status: "resolved",
    ...resolved,
    origin: revisionYears.length ? "ai_derived" : "ai_inferred",
    needsOwnerConfirmation: true,
    reasons: [
      revisionYears.length
        ? "根据同一提报中的唯一年份补全"
        : calendarYears.length
          ? "根据公开活动日历推测年份"
          : "根据当前日期推测年份",
    ],
  };
}

export function mergeCampaignThemeCandidates(input: {
  calendarCandidates: PublicCampaignCandidate[];
  startDate: string;
  endDate: string;
}): Array<{
  value: string;
  origin: "ai_inferred";
  sourceUrl: string;
}> {
  const seen = new Set<string>();
  return input.calendarCandidates
    .filter(
      (candidate) =>
        candidate.startDate <= input.endDate &&
        candidate.endDate >= input.startDate,
    )
    .filter((candidate) => {
      if (seen.has(candidate.name)) return false;
      seen.add(candidate.name);
      return true;
    })
    .map((candidate) => ({
      value: candidate.name,
      origin: "ai_inferred" as const,
      sourceUrl: candidate.sourceUrl,
    }));
}
