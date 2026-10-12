import { createHash } from "node:crypto";
import { z } from "zod";

export const activityCopyPromptVersion = "coupon-activity-copy-ai-v3";
export const activityCopyFactsVersion = "coupon-activity-copy-facts-v1";

const PLACEHOLDER_ACTIVITY_NAMES = new Set([
  "正常活动",
  "测试活动",
  "促销活动",
  "优惠券活动",
  "默认活动",
  "活动名称",
  "未命名活动",
  "待补充",
]);

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function isPlaceholderActivityName(value: string): boolean {
  const normalized = value.trim().replace(/[\s_\-—]/g, "");
  if (!normalized) return true;
  if (PLACEHOLDER_ACTIVITY_NAMES.has(normalized)) return true;
  if (/\.(xlsx|xls|csv)$/i.test(value.trim())) return true;
  return /^(正常|默认|测试|促销|优惠券|未命名|待补充)?活动(名称)?$/.test(
    normalized,
  );
}

export interface ActivityCopyTierFact {
  id: string;
  display: string;
  thresholdYuan: number;
  discountAmountYuan: number;
  evidenceCells: string[];
}

export interface ActivityCopyFacts {
  schemaVersion: typeof activityCopyFactsVersion;
  factsHash: string;
  sourceHashes: { coupon: string; whitelist?: string };
  period?: string;
  businessMode?: "严选" | "寄卖" | "pop";
  productLabel?: string;
  campaignTheme?: string;
  tiers: ActivityCopyTierFact[];
  sourceActivityNames: string[];
}

export function buildActivityCopyFacts(input: {
  sourceHashes: { coupon: string; whitelist?: string };
  period?: string;
  businessMode?: "严选" | "寄卖" | "pop";
  productLabel?: string;
  campaignTheme?: string;
  tiers: Array<Omit<ActivityCopyTierFact, "id"> & { id?: string }>;
  sourceActivityNames?: string[];
}): ActivityCopyFacts {
  if (!input.sourceHashes.coupon) {
    throw new Error("活动文案事实必须绑定配券表 hash");
  }
  if (!input.tiers.length) throw new Error("活动文案事实至少需要一个券档");
  const tiers = input.tiers.map((tier, index) => {
    if (
      !tier.display.trim() ||
      !Number.isFinite(tier.thresholdYuan) ||
      !Number.isFinite(tier.discountAmountYuan) ||
      tier.thresholdYuan <= tier.discountAmountYuan ||
      !tier.evidenceCells.length
    ) {
      throw new Error(`第 ${index + 1} 个券档事实无效`);
    }
    return {
      ...tier,
      id: tier.id ?? `tier-${index + 1}`,
      display: tier.display.trim(),
    };
  });
  const factsWithoutHash = {
    schemaVersion: activityCopyFactsVersion,
    sourceHashes: input.sourceHashes,
    period: input.period?.trim() || undefined,
    businessMode: input.businessMode,
    productLabel: input.productLabel?.trim() || undefined,
    campaignTheme: input.campaignTheme?.trim() || undefined,
    tiers,
    sourceActivityNames: [...new Set(input.sourceActivityNames ?? [])]
      .map((value) => value.trim())
      .filter((value) => value && !isPlaceholderActivityName(value)),
  } satisfies Omit<ActivityCopyFacts, "factsHash">;
  return {
    ...factsWithoutHash,
    factsHash: sha256(stableJson(factsWithoutHash)),
  };
}

const activityCopyProposalSchema = z.object({
  activityName: z.string().trim().min(1).max(120),
  activityBackground: z.string().trim().min(1).max(2000),
  coveredTierIds: z.array(z.string().min(1)).min(1).max(100),
  usedFactIds: z.array(z.string().min(1)).max(200).default([]),
  warnings: z.array(z.string().max(500)).max(20).default([]),
});

export interface ValidatedActivityCopy {
  status: "valid" | "invalid";
  activityName?: string;
  activityBackground?: string;
  coveredTierIds: string[];
  issues: string[];
  proposalHash?: string;
}

export function buildActivityCopyAiRequest(facts: ActivityCopyFacts): {
  promptVersion: string;
  system: string;
  user: string;
} {
  const allowedFactIds = [
    ...facts.tiers.map((tier) => tier.id),
    "period",
    "businessMode",
    "productLabel",
    "campaignTheme",
  ];
  const exampleNameParts = [
    facts.period,
    facts.businessMode,
    facts.productLabel,
    facts.campaignTheme,
  ].filter((value): value is string => Boolean(value));
  const exampleActivityName = `${exampleNameParts.join(" ")}优惠券申请`;
  const formatExample = {
    activityName: exampleActivityName,
    activityBackground: `本期申请${exampleActivityName.replace(/申请$/, "")}，本期配置${chineseCount(facts.tiers.length)}档优惠券：${facts.tiers.map((tier) => tier.display).join("、")}。`,
    coveredTierIds: facts.tiers.map((tier) => tier.id),
    usedFactIds: [
      "period",
      "businessMode",
      ...facts.tiers.map((tier) => tier.id),
    ],
    warnings: [],
  };
  return {
    promptVersion: activityCopyPromptVersion,
    system: [
      "你是内部优惠券活动文案候选生成器。",
      "只使用输入 facts，不得编造预算、GMV、ROI、渠道、商品范围、审批理由、超扣或内部政策。",
      "活动名称使用活动周期、业务模式、商品或活动主题和‘优惠券申请’组成可辨识名称。",
      "输入事实缺少业务模式、商品或活动主题时应省略该部分，绝不能输出‘业务模式’‘商品主题’等占位词。",
      `活动背景必须严格使用‘本期申请<活动名称去掉申请>，本期配置${chineseCount(facts.tiers.length)}档优惠券：<全部券档>。’结构，不得改写开头。`,
      "活动背景必须覆盖全部券档；每个金额、日期和商品事实必须来自 facts。",
      "不得输出正常活动、测试活动、促销活动、优惠券活动、默认活动、活动名称、未命名活动或待补充。",
      "只返回严格 JSON，并返回 coveredTierIds 与 usedFactIds；usedFactIds 只能逐项使用输入 allowedFactIds 中的完整字符串，不得使用 JSON 路径。",
    ].join("\n"),
    user: JSON.stringify({
      task: "生成可编辑的活动名称和活动背景候选",
      promptVersion: activityCopyPromptVersion,
      facts,
      allowedFactIds,
      outputContract: formatExample,
    }),
  };
}

function normalizedTier(value: string): string {
  return value.replace(/\s/g, "").replace(/^满/, "").replace(/减/g, "-");
}

export function validateActivityCopyProposal(input: {
  facts: ActivityCopyFacts;
  proposal: unknown;
}): ValidatedActivityCopy {
  const parsed = activityCopyProposalSchema.safeParse(input.proposal);
  if (!parsed.success) {
    return {
      status: "invalid",
      coveredTierIds: [],
      issues: ["AI 活动文案结构无效"],
    };
  }
  const issues: string[] = [];
  if (isPlaceholderActivityName(parsed.data.activityName)) {
    issues.push("活动名称仍是无业务含义的占位文字");
  }
  if (!parsed.data.activityName.endsWith("优惠券申请")) {
    issues.push("活动名称不符合优惠券申请文案结构");
  }
  const expectedTierIds = new Set(input.facts.tiers.map((tier) => tier.id));
  const coveredTierIds = new Set(parsed.data.coveredTierIds);
  for (const id of expectedTierIds) {
    if (!coveredTierIds.has(id)) issues.push(`活动背景遗漏券档 ${id}`);
  }
  for (const id of coveredTierIds) {
    if (!expectedTierIds.has(id)) issues.push(`活动背景引用未知券档 ${id}`);
  }
  const background = normalizedTier(parsed.data.activityBackground);
  const requiredTierSummary = `本期配置${chineseCount(input.facts.tiers.length)}档优惠券`;
  if (
    !parsed.data.activityBackground.includes("本期申请") ||
    !parsed.data.activityBackground.includes(requiredTierSummary)
  ) {
    issues.push("活动背景不符合已登记的活动文案结构");
  }
  for (const tier of input.facts.tiers) {
    if (!background.includes(normalizedTier(tier.display))) {
      issues.push(`活动背景没有写明券档 ${tier.display}`);
    }
  }
  const allowedFactIds = new Set([
    ...input.facts.tiers.map((tier) => tier.id),
    "period",
    "businessMode",
    "productLabel",
    "campaignTheme",
  ]);
  for (const id of parsed.data.usedFactIds) {
    if (!allowedFactIds.has(id)) issues.push(`活动文案引用未知事实 ${id}`);
  }
  const forbidden = ["预算", "GMV", "ROI", "审批理由", "超扣"];
  for (const word of forbidden) {
    if (
      parsed.data.activityName.includes(word) ||
      parsed.data.activityBackground.includes(word)
    ) {
      issues.push(`活动文案包含未授权事实：${word}`);
    }
  }
  const validated = {
    activityName: parsed.data.activityName,
    activityBackground: parsed.data.activityBackground,
    coveredTierIds: [...coveredTierIds],
  };
  return {
    status: issues.length ? "invalid" : "valid",
    ...validated,
    issues,
    proposalHash: sha256(stableJson(validated)),
  };
}

function chineseCount(value: number): string {
  return (
    ["", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"][value] ??
    String(value)
  );
}
