import { z } from "zod";
import { getDeepSeekConfig } from "./coupon-oa/excel-pilot-config";

export const deepSeekCouponExtractionSchema = z.object({
  fields: z.record(z.string(), z.unknown()),
  missingFields: z.array(z.string()).default([]),
  ambiguousFields: z.array(z.string()).default([]),
  unparsedText: z.string().default(""),
});

export type DeepSeekCouponExtraction = z.infer<
  typeof deepSeekCouponExtractionSchema
>;

const systemPrompt = `你是内部优惠券 Excel 试点的字段提取器。只提取用户明确提供的信息，绝不补猜。
返回严格 JSON 对象，格式为：
{"fields": {"字段key": 值}, "missingFields": ["缺少的字段key"], "ambiguousFields": ["有歧义的字段key"], "unparsedText": "未识别的内容"}。
支持字段：activityName, activityBackground, businessMode, activityPointPercent, applicantName, activityStartAt, activityEndAt, channels, thresholdYuan, discountAmountYuan, totalQuantity, grantQuantityPerClaim, dailyClaimLimit, claimWindow, useWindow, expectedClaimRate, expectedUseRate, platformBearingRatio, estimatedGmvYuan, claimRule, allowGift, promotionMode, publicPromotionChannels, overDeduction, overDeductionReason。
channels 只能输出 JD、PAIPAI 数组。百分比可输出小数或带百分号字符串。不要输出任何未提供字段，不要输出解释文字。`;

export async function extractCouponPilotFields(
  text: string,
): Promise<DeepSeekCouponExtraction> {
  const config = getDeepSeekConfig();
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
    }),
  });
  const payload = (await response.json()) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
  };
  if (!response.ok) {
    throw new Error(
      `DeepSeek 字段提取失败：${payload.error?.message ?? response.status}`,
    );
  }
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("DeepSeek 未返回字段提取结果");
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("DeepSeek 返回的字段结果不是有效 JSON");
  }
  const result = deepSeekCouponExtractionSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error("DeepSeek 返回的字段结果不符合试点格式");
  }
  return result.data;
}
