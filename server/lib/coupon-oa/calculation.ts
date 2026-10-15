import { z } from "zod";
import { foldFullWidth, parseFlexibleNumber } from "./number-text";

const requiredText = z.string().trim().min(1);
const positiveInteger = z.number().int().positive();
const positiveAmount = z.number().positive().finite();
const ratio = z.number().min(0).max(1).finite();
const nonZeroRatio = z.number().positive().max(1).finite();

export const regularFullReductionChannelSchema = z.enum(["JD", "PAIPAI"]);
export type RegularFullReductionChannel = z.infer<
  typeof regularFullReductionChannelSchema
>;

export const regularFullReductionInputSchema = z
  .object({
    activityName: requiredText.max(200),
    activityBackground: requiredText.max(4000),
    businessMode: z.enum(["严选", "寄卖", "pop"]),
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
    productLimitType: z.literal("限SKU").default("限SKU"),
    claimRiskControl: z.literal("0级以下用户可领").default("0级以下用户可领"),
    claimRule: z.enum(["活动期间仅可领一次", "活动期间每天可领一次"]),
    allowGift: z.enum(["允许", "不允许"]),
    promotionMode: z.enum(["公开自动推广", "非公开推广"]),
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
  const estimatedCostYuan =
    input.totalQuantity *
    input.discountAmountYuan *
    input.expectedUseRate *
    input.platformBearingRatio;
  if (!Number.isFinite(estimatedCostYuan) || estimatedCostYuan <= 0) {
    throw new Error(
      "预计费用必须为正数；请检查总申请数量、面额、使用率和平台承担比例",
    );
  }
  const estimatedRoi = input.estimatedGmvYuan / estimatedCostYuan;
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

export function normalizeRegularRatio(value: string): number | undefined {
  const text = foldFullWidth(value).trim();
  if (!text) return undefined;
  const parsed = text.endsWith("%")
    ? parseFlexibleNumber(text.slice(0, -1))
    : parseFlexibleNumber(text);
  if (parsed === undefined) return undefined;
  return text.endsWith("%") ? parsed / 100 : parsed;
}
