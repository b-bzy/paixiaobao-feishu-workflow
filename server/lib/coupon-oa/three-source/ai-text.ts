import { z } from "zod";
import type { CouponFieldKey } from "./types";

export const couponSupplementTextPromptVersion =
  "coupon-three-source-p0-supplement-v1";

const allowedKeys = [
  "activityName",
  "activityBackground",
  "businessMode",
  "applicantName",
  "activityStartAt",
  "activityEndAt",
  "channels",
  "thresholdYuan",
  "discountAmountYuan",
  "activityPointPercent",
  "totalQuantity",
  "grantQuantityPerClaim",
  "dailyClaimLimit",
  "claimWindow",
  "useWindow",
  "expectedClaimRate",
  "expectedUseRate",
  "platformBearingRatio",
  "estimatedGmvYuan",
  "claimRule",
  "allowGift",
  "promotionMode",
  "publicPromotionChannels",
  "overDeduction",
  "overDeductionReason",
] as const satisfies readonly CouponFieldKey[];

const fieldValueSchema = z.union([
  z.string().max(4000),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(200)).max(20),
]);

export const couponSupplementTextProposalSchema = z.object({
  fields: z.partialRecord(z.enum(allowedKeys), fieldValueSchema).default({}),
  warnings: z.array(z.string().max(500)).max(20).default([]),
});

export interface ValidatedCouponSupplementText {
  fields: Partial<Record<CouponFieldKey, string | number | boolean | string[]>>;
  warnings: string[];
}

function validDate(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
  );
}

export function validateCouponSupplementTextProposal(
  proposal: unknown,
): ValidatedCouponSupplementText {
  const parsed = couponSupplementTextProposalSchema.safeParse(proposal);
  if (!parsed.success) {
    return { fields: {}, warnings: ["AI 返回结构不符合补充字段格式"] };
  }
  const fields = { ...parsed.data.fields } as ValidatedCouponSupplementText["fields"];
  const warnings = [...parsed.data.warnings];
  const businessMode = fields.businessMode;
  if (
    businessMode !== undefined &&
    !["严选", "寄卖", "POP", "pop"].includes(String(businessMode))
  ) {
    delete fields.businessMode;
    warnings.push("AI 返回的业务模式不在允许范围内");
  }
  for (const key of ["activityStartAt", "activityEndAt"] as const) {
    if (fields[key] !== undefined && !validDate(fields[key])) {
      delete fields[key];
      warnings.push(`AI 返回的${key === "activityStartAt" ? "开始" : "结束"}日期无效`);
    }
  }
  return { fields, warnings };
}

export function buildCouponSupplementTextAiRequest(text: string): {
  promptVersion: string;
  system: string;
  user: string;
} {
  return {
    promptVersion: couponSupplementTextPromptVersion,
    system: [
      "你是内部优惠券提报的中文补充字段提取器。",
      "只提取业务员文字中明确提供的信息，不补猜、不生成审批结论。",
      "返回严格 JSON：{\"fields\":{...},\"warnings\":[]}。",
      `允许字段：${allowedKeys.join(", ")}。`,
      "businessMode 只能输出严选、寄卖或 POP；日期使用 YYYY-MM-DD。",
    ].join("\n"),
    user: JSON.stringify({
      task: "从业务员已检查的补充文字中提取字段候选",
      promptVersion: couponSupplementTextPromptVersion,
      text,
    }),
  };
}
