import { createHash } from "node:crypto";
import { z } from "zod";

export const activityCopyPromptVersion = "coupon-activity-copy-ai-v4";
export const activityCopyFactsVersion = "coupon-activity-copy-facts-v2";

export const OA_ACTIVITY_NAME_SUFFIX = "优惠券申请";

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
  if (/\.(xlsx|xls|csv)$/iu.test(value.trim())) return true;
  return /^(正常|默认|测试|促销|优惠券|未命名|待补充)?活动(名称)?$/.test(
    normalized,
  );
}

/**
 * The OA activity name template is 日期+品类+ID类型+优惠券类型 with the date
 * rendered as month-day only; the OA submission name never carries a year.
 */
export function formatCouponMonthDay(isoDate: string): string {
  const match = isoDate.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) {
    throw new Error("活动周期必须使用 YYYY-MM-DD 日期");
  }
  return `${Number(match[2])}.${Number(match[3])}`;
}

export function composeOaActivityName(input: {
  period: string;
  category?: string;
  idType?: string;
}): string {
  const dates = input.period
    .split("至")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!dates.length) {
    throw new Error("活动名称缺少活动周期");
  }
  const category = input.category?.trim();
  const idType = input.idType?.trim();
  return [
    dates.map(formatCouponMonthDay).join("-"),
    category || "",
    idType || "",
    OA_ACTIVITY_NAME_SUFFIX,
  ].join("");
}

export function oaActivityNameStructureIssue(
  value: string,
): string | undefined {
  if (!value.endsWith(OA_ACTIVITY_NAME_SUFFIX)) {
    return "活动名称不符合优惠券申请文案结构";
  }
  const body = value.slice(0, -OA_ACTIVITY_NAME_SUFFIX.length);
  if (body.includes(OA_ACTIVITY_NAME_SUFFIX)) {
    return "活动名称重复拼接了优惠券申请";
  }
  if (/\d{4}/u.test(value)) {
    return "活动名称不能包含年份";
  }
  return undefined;
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
  /** Grounded strings (file name, sheet names, coupon columns) the AI infers
   * the activity-name components from; never channels or free text. */
  nameHints: string[];
  tiers: ActivityCopyTierFact[];
  sourceActivityNames: string[];
}

export function buildActivityCopyFacts(input: {
  sourceHashes: { coupon: string; whitelist?: string };
  period?: string;
  businessMode?: "严选" | "寄卖" | "pop";
  productLabel?: string;
  campaignTheme?: string;
  nameHints?: string[];
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
  const nameHints = [
    ...new Set(
      (input.nameHints ?? [])
        .map((value) => value.trim().slice(0, 80))
        .filter(Boolean),
    ),
  ].slice(0, 40);
  const factsWithoutHash = {
    schemaVersion: activityCopyFactsVersion,
    sourceHashes: input.sourceHashes,
    period: input.period?.trim() || undefined,
    businessMode: input.businessMode,
    productLabel: input.productLabel?.trim() || undefined,
    campaignTheme: input.campaignTheme?.trim() || undefined,
    nameHints,
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
  nameComponents: z
    .object({
      category: z.string().trim().max(30).optional(),
      idType: z.string().trim().max(30).optional(),
    })
    .default({}),
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
  /** Soft notes such as dropped name components; they do not invalidate. */
  warnings: string[];
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
    "nameHints",
  ];
  const exampleActivityName = facts.period
    ? composeOaActivityName({
        period: facts.period,
        category: "〈品类〉",
        idType: "〈ID类型〉",
      })
    : `〈日期〉〈品类〉〈ID类型〉${OA_ACTIVITY_NAME_SUFFIX}`;
  const formatExample = {
    nameComponents: {
      category: "来自 nameHints 的商品品类",
      idType: "来自 nameHints 的标识类型",
    },
    activityBackground: `本期申请${exampleActivityName.replace(/申请$/u, "")}，本期配置${chineseCount(facts.tiers.length)}档优惠券：${facts.tiers.map((tier) => tier.display).join("、")}。`,
    coveredTierIds: facts.tiers.map((tier) => tier.id),
    usedFactIds: ["period", "nameHints", ...facts.tiers.map((tier) => tier.id)],
    warnings: [],
  };
  return {
    promptVersion: activityCopyPromptVersion,
    system: [
      "你是内部优惠券活动文案候选生成器。",
      "只使用输入 facts，不得编造预算、GMV、ROI、渠道、商品范围、审批理由、超扣或内部政策。",
      "活动名称由服务端按“日期+品类+ID类型+优惠券申请”模板拼装，日期只保留月日、不带年份；你只负责返回 nameComponents 两个组件。",
      "category 是商品品类（如 平板、乐器、手机、M系列Mini主机）；idType 是优惠券覆盖的标识类型（如 SKU、店铺SKU、商家ID、ID券）。",
      "两个组件都必须逐字来自 facts.nameHints 中的某条线索；推理不出时必须省略该字段，不得编造。",
      "组件内不得出现日期、金额、渠道名（如京东商城）、业务模式（严选、寄卖、pop）或“优惠券”“申请”字样。",
      "活动背景必须严格使用‘本期申请<活动名称去掉申请>，本期配置N档优惠券：<全部券档>。’结构，不得改写开头。",
      "活动背景必须覆盖全部券档；每个金额、日期和商品事实必须来自 facts。",
      "不得输出正常活动、测试活动、促销活动、优惠券活动、默认活动、活动名称、未命名活动或待补充。",
      "只返回严格 JSON，并返回 coveredTierIds 与 usedFactIds；usedFactIds 只能逐项使用输入 allowedFactIds 中的完整字符串，不得使用 JSON 路径。",
    ].join("\n"),
    user: JSON.stringify({
      task: "推理活动名称组件并生成活动背景候选",
      promptVersion: activityCopyPromptVersion,
      facts,
      allowedFactIds,
      outputContract: formatExample,
    }),
  };
}

function normalizedTier(value: string): string {
  return value.replace(/\s/g, "").replace(/^满/u, "").replace(/减/g, "-");
}

const NAME_COMPONENT_MAX_LENGTH = 20;

function validateNameComponent(
  label: string,
  value: string | undefined,
  hints: string[],
): { value?: string; warning?: string } {
  const trimmed = value?.trim();
  if (!trimmed) return {};
  if (trimmed.length > NAME_COMPONENT_MAX_LENGTH) {
    return { warning: `活动名称${label}过长，已忽略：${trimmed}` };
  }
  if (/\d{3,}/u.test(trimmed)) {
    return {
      warning: `活动名称${label}包含日期或金额数字，已忽略：${trimmed}`,
    };
  }
  if (trimmed.includes("优惠券") || trimmed.includes("申请")) {
    return {
      warning: `活动名称${label}包含券型或申请用词，已忽略：${trimmed}`,
    };
  }
  if (!hints.some((hint) => hint.includes(trimmed))) {
    return {
      warning: `活动名称${label}无法在来源线索中回溯，已忽略：${trimmed}`,
    };
  }
  return { value: trimmed };
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
      warnings: [],
    };
  }
  const issues: string[] = [];
  const warnings: string[] = [];
  const category = validateNameComponent(
    "品类",
    parsed.data.nameComponents.category,
    input.facts.nameHints,
  );
  const idType = validateNameComponent(
    "ID类型",
    parsed.data.nameComponents.idType,
    input.facts.nameHints,
  );
  for (const note of [category.warning, idType.warning]) {
    if (note) warnings.push(note);
  }
  let activityName: string;
  try {
    activityName = composeOaActivityName({
      period: input.facts.period ?? "",
      category: category.value,
      idType: idType.value,
    });
  } catch {
    return {
      status: "invalid",
      coveredTierIds: [],
      issues: ["活动文案事实缺少可格式化的活动周期"],
      warnings,
    };
  }
  if (isPlaceholderActivityName(activityName)) {
    issues.push("活动名称仍是无业务含义的占位文字");
  }
  const structureIssue = oaActivityNameStructureIssue(activityName);
  if (structureIssue) issues.push(structureIssue);
  if (activityName.length > 60) {
    issues.push("活动名称超过 60 字");
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
    "nameHints",
  ]);
  for (const id of parsed.data.usedFactIds) {
    if (!allowedFactIds.has(id)) issues.push(`活动文案引用未知事实 ${id}`);
  }
  const forbidden = ["预算", "GMV", "ROI", "审批理由", "超扣"];
  for (const word of forbidden) {
    if (
      activityName.includes(word) ||
      parsed.data.activityBackground.includes(word)
    ) {
      issues.push(`活动文案包含未授权事实：${word}`);
    }
  }
  const validated = {
    activityName,
    activityBackground: parsed.data.activityBackground,
    coveredTierIds: [...coveredTierIds],
  };
  return {
    status: issues.length ? "invalid" : "valid",
    ...validated,
    issues,
    warnings,
    proposalHash: sha256(stableJson(validated)),
  };
}

function chineseCount(value: number): string {
  return (
    ["", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"][value] ??
    String(value)
  );
}
