import { z } from "zod";
import { foldFullWidth, parseFlexibleNumber } from "./number-text";

const requiredText = z.string().trim().min(1);
const positiveInteger = z.number().int().positive();
const positiveAmount = z.number().positive().finite();
const ratio = z.number().min(0).max(1).finite();
const nonZeroRatio = z.number().positive().max(1).finite();

/**
 * 封闭枚举的宽容归一（软门禁）：表内用词只要能**无歧义**映射到唯一标准值，
 * 就自动采用标准值继续流程，不整单退回；映射不动的保持原样走严格校验。
 * 归一只改写进入校验的候选值，不改源单元格；归一结果会随确认快照留痕，
 * 且映射卡片会明示「已按标准值处理」。2026-10-18 Owner 裁定：宁可通过
 * +留痕，不要高频退回。
 */
const enumCanonicalRules: ReadonlyArray<{
  field: "claimRule" | "allowGift" | "promotionMode" | "businessMode";
  test: RegExp;
  canonical: string;
}> = [
  {
    field: "claimRule",
    test: /每天可领|每日可领/,
    canonical: "活动期间每天可领一次",
  },
  {
    field: "claimRule",
    test: /仅可领一次|仅限一次|只能领一次/,
    canonical: "活动期间仅可领一次",
  },
  { field: "allowGift", test: /^(是|可以|能|允许赠送)$/, canonical: "允许" },
  { field: "allowGift", test: /^(否|不可以|不能)$/, canonical: "不允许" },
  { field: "promotionMode", test: /非公开/, canonical: "非公开推广" },
  { field: "promotionMode", test: /公开/, canonical: "公开自动推广" },
  { field: "businessMode", test: /^pop$/i, canonical: "pop" },
];

export function normalizeCouponEnumInput(
  field: "claimRule" | "allowGift" | "promotionMode" | "businessMode",
  raw: unknown,
): string {
  if (typeof raw !== "string") return String(raw ?? "");
  const folded = foldFullWidth(raw).replace(/\s+/g, "");
  for (const rule of enumCanonicalRules) {
    if (rule.field !== field) continue;
    if (rule.test.test(folded)) return rule.canonical;
  }
  return raw.trim();
}

function withEnumNormalize<T extends z.ZodType<string>>(
  field: "claimRule" | "allowGift" | "promotionMode" | "businessMode",
  schema: T,
) {
  return z.preprocess(
    (raw) => normalizeCouponEnumInput(field, raw),
    schema,
  ) as unknown as T;
}

export const regularFullReductionChannelSchema = z.enum(["JD", "PAIPAI"]);
export type RegularFullReductionChannel = z.infer<
  typeof regularFullReductionChannelSchema
>;

export const regularFullReductionInputSchema = z
  .object({
    activityName: requiredText.max(200),
    activityBackground: requiredText.max(4000),
    businessMode: withEnumNormalize(
      "businessMode",
      z.enum(["严选", "寄卖", "pop"]),
    ),
    applicantName: requiredText.max(200),
    activityStartAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    activityEndAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    channels: z.array(regularFullReductionChannelSchema).min(1).max(2),
    thresholdYuan: positiveAmount,
    discountAmountYuan: positiveAmount,
    totalQuantity: positiveInteger,
    grantQuantityPerClaim: positiveInteger,
    dailyClaimLimit: positiveInteger,
    claimWindow: requiredText.max(100),
    useWindow: requiredText.max(100),
    expectedClaimRate: nonZeroRatio,
    expectedUseRate: nonZeroRatio,
    platformBearingRatio: ratio,
    estimatedGmvYuan: positiveAmount,
    couponType: z.literal("东券").default("东券"),
    productLimitType: z.enum(["限SKU", "限商家ID"]).default("限SKU"),
    claimRiskControl: z.literal("0级以下用户可领").default("0级以下用户可领"),
    claimRule: withEnumNormalize(
      "claimRule",
      z.enum(["活动期间仅可领一次", "活动期间每天可领一次"]),
    ),
    allowGift: withEnumNormalize("allowGift", z.enum(["允许", "不允许"])),
    promotionMode: withEnumNormalize(
      "promotionMode",
      z.enum(["公开自动推广", "非公开推广"]),
    ),
    publicPromotionChannels: z.array(requiredText).max(4).default([]),
    overDeduction: z.enum(["是", "否"]),
    overDeductionReason: z.string().trim().max(4000).default(""),
  })
  .superRefine((value, context) => {
    if (new Set(value.channels).size !== value.channels.length) {
      context.addIssue({
        code: "custom",
        path: ["channels"],
        message: "用券渠道不能重复",
      });
    }
    if (value.thresholdYuan <= value.discountAmountYuan) {
      context.addIssue({
        code: "custom",
        path: ["discountAmountYuan"],
        message: "优惠面额必须小于满减门槛",
      });
    }
    if (value.grantQuantityPerClaim > value.totalQuantity) {
      context.addIssue({
        code: "custom",
        path: ["grantQuantityPerClaim"],
        message: "单次到账张数不能大于总申请数量",
      });
    }
    if (value.activityEndAt < value.activityStartAt) {
      context.addIssue({
        code: "custom",
        path: ["activityEndAt"],
        message: "活动结束日期不能早于开始日期",
      });
    }
    if (value.overDeduction === "是" && !value.overDeductionReason) {
      context.addIssue({
        code: "custom",
        path: ["overDeductionReason"],
        message: "超扣点时必须填写原因",
      });
    }
    if (
      value.promotionMode === "公开自动推广" &&
      value.publicPromotionChannels.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["publicPromotionChannels"],
        message: "公开自动推广时必须填写公开推广渠道",
      });
    }
    if (
      value.promotionMode === "非公开推广" &&
      value.publicPromotionChannels.length > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["publicPromotionChannels"],
        message: "非公开推广时不能填写公开推广渠道",
      });
    }
  });

export type RegularFullReductionInput = z.infer<
  typeof regularFullReductionInputSchema
>;

export interface RegularFullReductionComputedValues {
  couponName: string;
  discountRatio: number;
  estimatedCostYuan: number;
  estimatedRoi: number;
}

export function computeRegularFullReductionValues(
  input: RegularFullReductionInput,
): RegularFullReductionComputedValues {
  // Feishu amount controls store cent precision; rounding at the value
  // finalization point keeps the confirmed snapshot, the submitted form and
  // the readback comparable instead of differing by float-multiplication
  // tails (e.g. 450000.00000000006).
  const estimatedCostYuan = roundYuanToCents(
    input.totalQuantity *
      input.discountAmountYuan *
      input.expectedUseRate *
      input.platformBearingRatio,
  );
  if (!Number.isFinite(estimatedCostYuan) || estimatedCostYuan <= 0) {
    throw new Error(
      "预计费用必须为正数；请检查总申请数量、面额、使用率和平台承担比例",
    );
  }
  const estimatedRoi = roundYuanToCents(
    input.estimatedGmvYuan / estimatedCostYuan,
  );
  if (!Number.isFinite(estimatedRoi) || estimatedRoi <= 0) {
    throw new Error("预估 ROI 无法计算");
  }
  return {
    couponName: `满${input.thresholdYuan}减${input.discountAmountYuan}`,
    discountRatio: input.discountAmountYuan / input.thresholdYuan,
    estimatedCostYuan,
    estimatedRoi,
  };
}

export function roundYuanToCents(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Math.round(value * 100) / 100;
}

export function normalizeRegularRatio(value: string): number | undefined {
  const text = foldFullWidth(value).trim();
  if (!text) return undefined;
  const parsed = text.endsWith("%")
    ? parseFlexibleNumber(text.slice(0, -1))
    : parseFlexibleNumber(text);
  if (parsed === undefined) return undefined;
  return text.endsWith("%") ? parsed / 100 : parsed;
}
