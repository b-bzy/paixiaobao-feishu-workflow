import { parseFlexibleNumber } from "../number-text";
import { canonicalCouponBusinessDate } from "./business-date";
import type { CouponFieldKey } from "./types";

export interface CouponOwnerInputIssue {
  key: CouponFieldKey;
  label: string;
  input: string;
  message: string;
}

/** Canonical Chinese label per field; shared by card rendering and errors. */
export const couponFieldLabels: Record<CouponFieldKey, string> = {
  activityName: "活动名称",
  activityBackground: "活动背景",
  businessMode: "业务模式",
  applicantName: "申请人",
  activityStartAt: "活动开始日期",
  activityEndAt: "活动结束日期",
  channels: "用券渠道",
  thresholdYuan: "使用门槛（元）",
  discountAmountYuan: "优惠金额（元）",
  activityPointPercent: "活动点位（%）",
  totalQuantity: "申请总数量",
  grantQuantityPerClaim: "单次发放数量",
  dailyClaimLimit: "每日领取上限",
  claimWindow: "领取时间",
  useWindow: "使用时间",
  expectedClaimRate: "预计领取率",
  expectedUseRate: "预计使用率",
  platformBearingRatio: "平台承担比例",
  estimatedGmvYuan: "预计成交额（元）",
  claimRule: "领取规则",
  allowGift: "是否允许转赠",
  promotionMode: "推广方式",
  publicPromotionChannels: "公开推广渠道",
  overDeduction: "是否超扣",
  overDeductionReason: "超扣原因",
};

const labels = couponFieldLabels;

const positiveNumberKeys = new Set<CouponFieldKey>([
  "thresholdYuan",
  "discountAmountYuan",
  "totalQuantity",
  "grantQuantityPerClaim",
  "dailyClaimLimit",
  "estimatedGmvYuan",
]);
const ratioKeys = new Set<CouponFieldKey>([
  "expectedClaimRate",
  "expectedUseRate",
  "platformBearingRatio",
]);

function issue(
  key: CouponFieldKey,
  value: unknown,
  message: string,
): CouponOwnerInputIssue {
  return {
    key,
    label: labels[key] ?? "业务字段",
    input: String(value ?? ""),
    message,
  };
}

function text(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .trim();
}

function numeric(value: unknown): number | undefined {
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  return parseFlexibleNumber(text(value));
}

export function normalizeCouponOwnerInputs(
  values: Partial<Record<CouponFieldKey, unknown>>,
): {
  values: Partial<Record<CouponFieldKey, unknown>>;
  issues: CouponOwnerInputIssue[];
} {
  const normalized = { ...values };
  const issues: CouponOwnerInputIssue[] = [];
  for (const [rawKey, value] of Object.entries(values)) {
    const key = rawKey as CouponFieldKey;
    if (key === "activityStartAt" || key === "activityEndAt") {
      const date = canonicalCouponBusinessDate(value);
      if (date) normalized[key] = date;
      else
        issues.push(
          issue(key, value, `${labels[key]}请输入完整日期，例如 2026-09-30`),
        );
      continue;
    }
    if (key === "businessMode") {
      const candidate = text(value).toLowerCase();
      const mode = ["pop", "泡泡"].includes(candidate)
        ? "pop"
        : candidate === "严选" || candidate === "寄卖"
          ? candidate
          : undefined;
      if (mode) normalized[key] = mode;
      else issues.push(issue(key, value, "业务模式请选择严选、寄卖或 POP"));
      continue;
    }
    if (positiveNumberKeys.has(key)) {
      const candidate = numeric(value);
      if (candidate !== undefined && candidate > 0) normalized[key] = candidate;
      else issues.push(issue(key, value, `${labels[key]}请输入大于 0 的数字`));
      continue;
    }
    if (ratioKeys.has(key)) {
      const candidateText = text(value);
      const percent = candidateText.endsWith("%");
      const candidate = numeric(candidateText.replace(/%$/, ""));
      const ratio =
        candidate === undefined
          ? undefined
          : percent
            ? candidate / 100
            : candidate;
      if (ratio !== undefined && ratio >= 0 && ratio <= 1)
        normalized[key] = ratio;
      else issues.push(issue(key, value, `${labels[key]}请输入 0% 至 100%`));
      continue;
    }
    normalized[key] = Array.isArray(value)
      ? value.map((item) => text(item)).filter(Boolean)
      : text(value);
  }
  return { values: normalized, issues };
}

export function couponOwnerRepairText(issues: CouponOwnerInputIssue[]): string {
  return [
    "请只纠正以下业务员输入并返回对应标准字段，不补充未提供的业务事实：",
    ...issues.map(
      (item) =>
        `${item.label}（${item.key}）：${item.input}。要求：${item.message}`,
    ),
  ].join("\n");
}
