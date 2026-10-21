import { normalizeCouponEnumInput } from "../../../coupon-oa/calculation";
import { isPlaceholderActivityName } from "../../../coupon-oa/three-source/activity-copy";
import { canonicalCouponBusinessDate } from "../../../coupon-oa/three-source/business-date";
import {
  detectIdentifierDimensionEvidence,
  type IdentifierDimensionEvidenceColumn,
} from "../../../coupon-oa/three-source/lists";
import type {
  CouponCandidate,
  CouponFieldKey,
} from "../../../coupon-oa/three-source/types";
import type { FeishuCard } from "../../expense-poc";
import { buildCouponThreeSourceRevisionedActionName } from "./action-name";
import type { FrozenThreeSourceArtifact } from "./handoff";
import { getCouponThreeSourcePreviewWebBaseUrl } from "./pilot-config";
import type {
  CouponThreeSourcePilotDraft,
  StoredWorkbookRecognition,
} from "./store";
import { computeCouponThreeSourceMappingContextHash } from "./store";

const plainText = (content: string) => ({ tag: "plain_text", content });

function card(input: {
  title: string;
  subtitle: string;
  template: string;
  content?: string;
  elements?: Array<Record<string, unknown>>;
}): FeishuCard {
  return {
    schema: "2.0",
    config: { update_multi: true, width_mode: "default" },
    header: {
      title: plainText(input.title),
      subtitle: plainText(input.subtitle),
      template: input.template,
      icon: { tag: "standard_icon", token: "form_colorful" },
    },
    body: {
      direction: "vertical",
      padding: "12px 12px 20px 12px",
      vertical_spacing: "12px",
      elements: input.elements ?? [
        { tag: "markdown", content: input.content ?? "" },
      ],
    },
  };
}

function actionValue(draft: CouponThreeSourcePilotDraft, action: string) {
  return {
    action,
    pilotRecordId: draft.recordId,
    revision: draft.task.revision,
  };
}

function button(
  draft: CouponThreeSourcePilotDraft,
  input: {
    action: string;
    text: string;
    type?: string;
    extra?: Record<string, unknown>;
  },
): Record<string, unknown> {
  return {
    tag: "button",
    text: plainText(input.text),
    type: input.type ?? "primary_filled",
    width: "fill",
    behaviors: [
      {
        type: "callback",
        value: { ...actionValue(draft, input.action), ...input.extra },
      },
    ],
  };
}

function cancelButton(
  draft: CouponThreeSourcePilotDraft,
): Record<string, unknown> {
  return button(draft, {
    action: "coupon_three_source_cancel",
    text: "结束当前三源提报",
    type: "danger",
  });
}

function sourcesSummary(draft: CouponThreeSourcePilotDraft): string[] {
  const sources = draft.task.sources;
  const confirmedImages = draft.task.confirmedCalcImages;
  const pendingImages = draft.task.pendingCalcImages;
  return [
    `- 配券表：${sources.couponTable?.fileName ?? "待上传"}`,
    `- 商品白名单：${sources.whitelist?.fileName ?? "待上传"}`,
    `- 商品黑名单：${
      sources.blacklist?.fileName ??
      (draft.task.blacklistStatus === "absent_confirmed"
        ? "已确认无黑名单"
        : "待上传或确认无黑名单")
    }`,
    `- 已确认测算图片：${confirmedImages.length} 张${confirmedImages.length ? `（${confirmedImages.map((image) => image.fileName).join("、")}）` : ""}`,
    `- 待确认测算图片：${pendingImages.length} 张${pendingImages.length ? `（${pendingImages.map((image) => image.fileName).join("、")}）` : ""}`,
  ];
}

export function buildCouponThreeSourceUnavailableCard(): FeishuCard {
  return card({
    title: "OA 优惠券提报暂未开放",
    subtitle: "三源 Bot 试点未启用",
    template: "orange",
    content: [
      "`/OA优惠券提报` 的服务端试点模块默认关闭。",
      "当前不会读取来源文件、创建系统草稿、上传文件或创建原生 OA。",
      "请继续使用已开放流程，或联系试点维护人完成受控资源配置。",
    ].join("\n"),
  });
}

export function buildCouponThreeSourceRuntimeBlockedCard(): FeishuCard {
  return card({
    title: "OA 优惠券提报尚不能开始",
    subtitle: "当前用户或环境未通过试点 Gate",
    template: "orange",
    content: [
      "系统没有读取来源文件、创建任务、写入 Base/Drive 或创建原生 OA。",
      "请由试点维护人确认功能开关、用户权限和受控资源后再开启。",
    ].join("\n"),
  });
}

export function buildCouponThreeSourceGeneratingArtifactsCard(): FeishuCard {
  return card({
    title: "标准附件生成中",
    subtitle: "已确认信息，请等待最新卡片",
    template: "orange",
    content: [
      "正在冻结当前版本并生成标准配券表与白名单，通常需要几秒到十几秒。",
      "本卡片的确认按钮已收起以防止重复点击；完成后会自动发出最新卡片。",
    ].join("\n"),
  });
}

export function buildCouponThreeSourceClearedCard(input: {
  clearedCount: number;
  closedOaDraftCount?: number;
}): FeishuCard {
  const cleared = input.clearedCount > 0;
  return card({
    title: cleared ? "当前三源提报已清空" : "当前已是清空状态",
    subtitle: "可以重新发起 OA 优惠券提报",
    template: "green",
    content: [
      cleared
        ? `已结束 ${input.clearedCount} 笔未完成的三源提报。`
        : "没有检测到未完成的三源提报。",
      ...(input.closedOaDraftCount
        ? [`同时关闭了 ${input.closedOaDraftCount} 张本次试点交接的 OA 草稿。`]
        : []),
      "原始记录和文件仅保留用于审计，不会被下一次提报复用。",
      "请重新发送 `/OA优惠券提报`，并重新上传本次材料。",
    ].join("\n"),
  });
}

export function buildCouponThreeSourceIntakeCard(
  draft?: CouponThreeSourcePilotDraft,
): FeishuCard {
  const content = [
    "请直接发送原始 `.xlsx` 配券表、商品白名单，以及可选商品黑名单（可任意顺序）。",
    ...(draft ? ["", "**当前材料**", ...sourcesSummary(draft)] : []),
  ].join("\n");
  return card({
    title: "OA 优惠券提报",
    subtitle: "第 1 步：收集三源材料",
    template: "blue",
    ...(draft
      ? {
          elements: [
            { tag: "markdown", content },
            button(draft, {
              action: "coupon_three_source_recognition_start",
              text: "材料已上传完毕，开始统一识别",
            }),
            cancelButton(draft),
          ],
        }
      : { content }),
  });
}

export function buildCouponThreeSourceRoleCard(input: {
  draft: CouponThreeSourcePilotDraft;
  recognition: StoredWorkbookRecognition;
}): FeishuCard {
  const detectedRoles = input.recognition.roleCandidates.map(
    (candidate) => candidate.role,
  );
  const looksLikeList = input.recognition.listCandidates.some(
    (candidate) => candidate.kind === "identifier",
  );
  const roles = [
    ...new Set([
      ...detectedRoles,
      ...(looksLikeList ? (["whitelist", "blacklist"] as const) : []),
    ]),
  ];
  return card({
    title: "确认材料角色",
    subtitle: "系统无法唯一判断刚上传的 Excel",
    template: "orange",
    elements: [
      {
        tag: "markdown",
        content: [
          `**文件：** ${input.recognition.source.fileName}`,
          input.draft.task.sources.whitelist && looksLikeList
            ? "已有白名单。请确认这份新名单是替换现有白名单，还是作为商品黑名单；系统不会自动覆盖。"
            : "请选择该文件在本次三源提报中的角色。选择后会替换同角色材料并产生新 revision。",
        ].join("\n"),
      },
      ...roles.map((role) =>
        button(input.draft, {
          action: "coupon_three_source_role_confirm",
          text:
            role === "couponTable"
              ? "作为配券表"
              : role === "whitelist"
                ? input.draft.task.sources.whitelist
                  ? "替换现有商品白名单"
                  : "作为商品白名单"
                : "作为商品黑名单",
          extra: { role },
        }),
      ),
      cancelButton(input.draft),
    ],
  });
}

export function buildCouponThreeSourceNoBlacklistCard(
  draft: CouponThreeSourcePilotDraft,
): FeishuCard {
  return card({
    title: "请确认是否有黑名单",
    subtitle: "需要你确认：未上传不等于没有黑名单",
    template: "orange",
    elements: [
      {
        tag: "markdown",
        content: [
          ...sourcesSummary(draft),
          "",
          "若本次确实没有商品黑名单，请由创建人明确确认。若有黑名单，请直接发送原始 `.xlsx` 文件。",
        ].join("\n"),
      },
      button(draft, {
        action: "coupon_three_source_no_blacklist_confirm",
        text: "确认本次无黑名单",
        type: "danger",
      }),
      cancelButton(draft),
    ],
  });
}

export function buildCouponThreeSourceRecognizingCard(
  draft: CouponThreeSourcePilotDraft,
): FeishuCard {
  const pending = Object.entries(draft.recognitions)
    .filter(([, recognition]) => recognition?.ai?.status === "pending")
    .map(([role, recognition]) => `- ${role}：${recognition?.source.fileName}`);
  return card({
    title: "AI 识别中",
    subtitle: "第 2 步：系统识别中，无需操作",
    template: "blue",
    elements: [
      {
        tag: "markdown",
        content: [
          "DeepSeek 当前只识别候选，不会生成表格或创建 OA。",
          ...pending,
          "识别完成后进入第 3 步：核对并补充活动信息。",
          "识别失败或超时会自动转为人工填写（通常一分钟内），无需操作，请等待最新卡片。",
        ].join("\n"),
      },
      cancelButton(draft),
    ],
  });
}

function combinedCouponCandidates(
  recognition: StoredWorkbookRecognition | undefined,
): CouponCandidate[] {
  if (!recognition) return [];
  const aiCandidates = recognition.ai?.primary
    ? (recognition.ai.result?.couponCandidates ?? [])
    : [];
  const result = [...aiCandidates];
  for (const candidate of recognition.couponCandidates ?? []) {
    if (
      !result.some(
        (item) =>
          item.sheetName === candidate.sheetName && item.row === candidate.row,
      )
    ) {
      result.push(candidate);
    }
  }
  return result;
}

const ownerSupplementKeys = [
  "activityName",
  "activityBackground",
  "businessMode",
  "applicantName",
  "activityStartAt",
  "activityEndAt",
  "channels",
  "thresholdYuan",
  "discountAmountYuan",
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
] as const satisfies readonly CouponFieldKey[];

const optionalOwnerSupplementKeys = [
  "publicPromotionChannels",
] as const satisfies readonly CouponFieldKey[];

/**
 * 封闭枚举字段的卡片选项与默认值：表单入口一律用选择组件代替自由文本，
 * 默认值仅为可改的预选（表内合法值优先），owner 提交为准，不改写任何原值。
 */
const enumFieldChoices: Partial<
  Record<
    CouponFieldKey,
    {
      options: Array<{ text: string; value: string }>;
      defaultValue?: string;
    }
  >
> = {
  claimRule: {
    options: [
      { text: "活动期间仅可领一次", value: "活动期间仅可领一次" },
      { text: "活动期间每天可领一次", value: "活动期间每天可领一次" },
    ],
    defaultValue: "活动期间每天可领一次",
  },
  allowGift: {
    options: [
      { text: "允许", value: "允许" },
      { text: "不允许", value: "不允许" },
    ],
    defaultValue: "不允许",
  },
  promotionMode: {
    options: [
      { text: "公开自动推广", value: "公开自动推广" },
      { text: "非公开推广", value: "非公开推广" },
    ],
  },
  publicPromotionChannels: {
    options: [
      { text: "全网推广", value: "全网推广" },
      { text: "单品页购物车", value: "单品页购物车" },
      { text: "领券中心", value: "领券中心" },
      { text: "公开券池", value: "公开券池" },
    ],
  },
};

const fieldLabels: Partial<Record<CouponFieldKey, string>> = {
  activityName: "活动名称",
  activityBackground: "活动背景",
  businessMode: "业务模式",
  applicantName: "申请人",
  activityStartAt: "活动开始日期",
  activityEndAt: "活动结束日期",
  channels: "用券渠道",
  thresholdYuan: "使用门槛（元）",
  discountAmountYuan: "优惠金额（元）",
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

/** Structured values must never stringify into "[object Object]" on a card. */
function primitiveText(value: unknown): string {
  if (["string", "number", "boolean"].includes(typeof value)) {
    return String(value);
  }
  return "";
}

function ownerFieldDisplayValue(key: CouponFieldKey, value: unknown): string {
  if (key === "activityStartAt" || key === "activityEndAt") {
    return canonicalCouponBusinessDate(value) ?? primitiveText(value);
  }
  return Array.isArray(value)
    ? value
        .map((item) => primitiveText(item))
        .filter(Boolean)
        .join("、")
    : primitiveText(value);
}

export function ownerDefaultValue(
  draft: CouponThreeSourcePilotDraft,
  key: CouponFieldKey,
): string | undefined {
  const ownerValue = draft.selections.ownerFieldValues?.[key];
  if (ownerValue !== undefined) {
    return ownerFieldDisplayValue(key, ownerValue);
  }
  const couponAi = draft.recognitions.couponTable?.ai;
  const copy =
    couponAi?.primary && couponAi.activityCopyEnabled
      ? couponAi.result?.activityCopyCandidates?.find(
          (candidate) => candidate.key === key,
        )
      : undefined;
  if (
    copy?.value &&
    (key !== "activityName" || !isPlaceholderActivityName(copy.value))
  ) {
    return copy.value;
  }
  const aiField = couponAi?.primary
    ? couponAi.result?.fieldCandidates.find(
        (candidate) => candidate.key === key && candidate.value !== undefined,
      )
    : undefined;
  if (aiField?.value !== undefined) {
    const value = ownerFieldDisplayValue(key, aiField.value);
    if (key !== "activityName" || !isPlaceholderActivityName(value)) {
      return value;
    }
  }
  const deterministic = draft.recognitions.couponTable?.couponFieldCandidates[
    key
  ]
    ?.flatMap((candidate) => candidate.sampleValues)
    .find((value) => value.trim());
  if (
    deterministic &&
    (key !== "activityName" || !isPlaceholderActivityName(deterministic))
  ) {
    return deterministic;
  }
  return undefined;
}

// Feishu input components accept max_length up to 1,000 (component docs);
// prefill above this budget is DROPPED, never truncated — default_value is
// submitted as-is into the confirmed owner values and would silently alter
// business data on its way to the OA prefill. Oversize fields are surfaced
// in a notice and stay editable for manual entry.
export const CARD_PREFILL_MAX_LENGTH = 800;
const FIELD_DISPLAY_MAX_LENGTH = 200;
const OVERSIZE_PREFILL_BASE_KEYS = [
  "overDeductionReason",
  "activityName",
  "activityBackground",
  "activityStartAt",
  "activityEndAt",
] as const satisfies readonly CouponFieldKey[];

function prefillOrDefault(
  draft: CouponThreeSourcePilotDraft,
  key: CouponFieldKey,
): string | undefined {
  const value = ownerDefaultValue(draft, key);
  return value !== undefined && value.length <= CARD_PREFILL_MAX_LENGTH
    ? value
    : undefined;
}

function isOversizePrefill(
  draft: CouponThreeSourcePilotDraft,
  key: CouponFieldKey,
): boolean {
  return (ownerDefaultValue(draft, key)?.length ?? 0) > CARD_PREFILL_MAX_LENGTH;
}

function clampDisplayText(text: string): string {
  return text.length > FIELD_DISPLAY_MAX_LENGTH
    ? `${text.slice(0, FIELD_DISPLAY_MAX_LENGTH)}…`
    : text;
}

function missingOwnerFields(
  recognition: StoredWorkbookRecognition | undefined,
): CouponFieldKey[] {
  if (!recognition) return [...ownerSupplementKeys];
  return ownerSupplementKeys.filter(
    (key) =>
      !recognition.couponFieldCandidates[key]?.some((candidate) =>
        candidate.sampleValues.some((value) => value.trim()),
      ) &&
      !recognition.ai?.result?.fieldCandidates?.some(
        (candidate) => candidate.key === key,
      ),
  );
}

/**
 * Fields recorded by a failed mapping confirmation (`输入校验[key]：…`) must
 * stay editable on the restored card even though workbook recognition found
 * a column — the selected row's value was missing or unreadable, and the
 * owner's supplement takes precedence over the workbook cell.
 */
function validationIssueFieldKeys(
  validationIssues: string[],
): CouponFieldKey[] {
  return validationIssues.flatMap((issue) => {
    const match = issue.match(/^输入校验\[([a-zA-Z]+)\]/);
    return match ? [match[1] as CouponFieldKey] : [];
  });
}

function overDeductionChoice(
  draft: CouponThreeSourcePilotDraft,
): "是" | "否" | undefined {
  const value = ownerDefaultValue(draft, "overDeduction")?.trim();
  return value === "是" || value === "否" ? value : undefined;
}

function aiStatusContent(draft: CouponThreeSourcePilotDraft): string[] {
  const lines: string[] = [];
  const workbookAi = draft.recognitions.couponTable?.ai;
  if (workbookAi?.status === "pending") {
    lines.push("**DeepSeek 表格识别：** 正在处理，请稍候。");
  } else if (workbookAi?.status === "succeeded") {
    lines.push(
      "**DeepSeek 表格识别已完成：** 已回填通过校验的候选，请检查后提交。",
    );
  } else if (workbookAi) {
    lines.push("**DeepSeek 表格识别未完成：** 已降级为人工检查和填写。");
  }
  const supplement = draft.supplementRecognition;
  if (supplement?.status === "pending") {
    lines.push(
      supplement.kind === "form_repair"
        ? "**输入纠错：** DeepSeek 正在识别格式问题，完成后会更新本卡片。"
        : "**补充说明识别：** 正在处理，完成后会更新本卡片。",
    );
  } else if (supplement?.status === "succeeded") {
    lines.push(
      supplement.kind === "form_repair"
        ? "**输入纠错已完成：** 已回填通过强校验的候选，请再次检查并提交。"
        : "**补充说明识别已完成：** 已回填空白字段，原有人工内容未被覆盖。",
    );
  } else if (supplement) {
    lines.push("**补充说明识别失败，请直接检查并填写字段。**");
  }
  return lines;
}

export interface IdentifierDimensionChoice {
  detected: "SKU" | "SPU" | "MERCHANT_ID" | "UNKNOWN";
  /** Headerless identifier candidates and any non-SKU detection must be
   * confirmed by the owner even when the AI already judged SKU. */
  requiresChoice: boolean;
  /** bug-fix-6：同一来源存在 ≥2 种受支持标识维度（如 店铺id+sku 双列）。
   * owner 的确认此时是“选路”（只采所选列），不是维度改写。 */
  multiDimension?: boolean;
  /** 多维度场景下供确认卡文案展示的列证据（表头 + 维度 + 来源）。 */
  evidenceColumns?: IdentifierDimensionEvidenceColumn[];
  aiJudgment?: {
    dimension: "SKU" | "SPU" | "MERCHANT_ID" | "UNKNOWN";
    reason: string;
  };
}

/**
 * Single source of truth for identifier-dimension confirmation triggers;
 * the dispatcher reuses it so the card and the form parsing cannot drift.
 */
export function identifierDimensionChoice(
  recognition: StoredWorkbookRecognition | undefined,
  role?: "whitelist" | "blacklist",
): IdentifierDimensionChoice | undefined {
  if (!recognition) return undefined;
  const identifier = recognition.listCandidates.find(
    (candidate) => candidate.kind === "identifier",
  );
  // bug-fix-6：维度证据统一走领域层探测（AI 区域 ∪ 确定性候选），
  // 卡片、提交校验与解析守卫共享同一结论。
  const evidence = detectIdentifierDimensionEvidence({
    listCandidates: recognition.listCandidates,
    aiRegions: recognition.ai?.result?.skuRegionCandidates,
    role,
  });
  const aiRegion =
    recognition.ai?.result?.skuRegionCandidates?.find(
      (candidate) =>
        candidate.dimension === "SKU" || candidate.dimension === "MERCHANT_ID",
    ) ?? recognition.ai?.result?.skuRegionCandidates?.[0];
  const detected =
    identifier?.dimension && identifier.dimension !== "UNKNOWN"
      ? identifier.dimension
      : aiRegion &&
          (aiRegion.dimension === "SKU" || aiRegion.dimension === "MERCHANT_ID")
        ? aiRegion.dimension
        : (identifier?.dimension ?? "SKU");
  const requiresChoice =
    Boolean(identifier && identifier.header === "") ||
    detected !== "SKU" ||
    evidence.multiDimension;
  return {
    detected,
    requiresChoice,
    ...(evidence.multiDimension
      ? { multiDimension: true, evidenceColumns: evidence.columns }
      : {}),
    aiJudgment: aiRegion
      ? { dimension: aiRegion.dimension, reason: aiRegion.reason }
      : undefined,
  };
}

function identifierDimensionLabel(
  dimension: "SKU" | "SPU" | "MERCHANT_ID" | "UNKNOWN",
): string {
  if (dimension === "MERCHANT_ID") return "商家 ID";
  if (dimension === "SKU") return "SKU";
  if (dimension === "SPU") return "SPU";
  return "无法判定";
}

function identifierDimensionConfirmBlock(input: {
  role: "whitelist" | "blacklist";
  fileName: string;
  choice: IdentifierDimensionChoice;
}): Array<Record<string, unknown>> {
  const roleLabel = input.role === "whitelist" ? "白名单" : "黑名单";
  // bug-fix-6：多列并存（如 店铺id+sku）与单列无表头是两种不同的事实,
  // 文案分开——前者是“选路”（未选列不进名单）,后者是“确认类型”。
  const introLine = input.choice.multiDimension
    ? (() => {
        const columns = (input.choice.evidenceColumns ?? [])
          .map(
            (column) =>
              `${column.header || `${column.column ?? "?"} 列`} 列【${identifierDimensionLabel(column.dimension)}】`,
          )
          .join("、");
        return `**${roleLabel}标识类型确认：** ${input.fileName} 同时检测到多种标识列（${columns || "SKU 与 商家 ID"}）。当前标准产物按单一标识维度生成，请选择本单使用的标识类型；未选择的列不会进入名单。`;
      })()
    : `**${roleLabel}标识类型确认：** ${input.fileName} 是无表头或标识含义不明确的单列数据。${input.choice.aiJudgment ? `系统判定该名单为【${identifierDimensionLabel(input.choice.detected)}】（依据：${input.choice.aiJudgment.reason}）。` : input.choice.detected === "UNKNOWN" ? "系统未能判定该名单的标识类型。" : `系统判定该名单为【${identifierDimensionLabel(input.choice.detected)}】。`}请确认实际类型后按该类型生成；系统不会改写任何原值。`;
  return [
    {
      tag: "markdown",
      content: introLine,
    },
    {
      tag: "select_static",
      name: `${input.role}_identifierDimension`,
      placeholder: plainText(`请确认${roleLabel}标识类型`),
      required: true,
      width: "fill",
      options: [
        { text: plainText("商家 ID"), value: "MERCHANT_ID" },
        { text: plainText("SKU"), value: "SKU" },
      ],
    },
  ];
}

/**
 * 提交时对未选择枚举字段的服务端默认值：仅当该字段会进入 owner 修正区
 * （表内缺失/非法/AI 低置信）且表内当前值不是合法选项时才给默认——绝不
 * 覆盖合法表值。select_static 不支持 default_value（真发 200621）无法客
 * 户端预选，默认值经此在 dispatcher 提交合并时兜底，卡片占位文案同步告知。
 */
const enumDisclosureKeys = [
  "claimRule",
  "allowGift",
  "promotionMode",
  "businessMode",
] as const;

function enumNormalizationNotes(draft: CouponThreeSourcePilotDraft): string[] {
  const coupon = draft.recognitions.couponTable;
  const notes: string[] = [];
  for (const key of enumDisclosureKeys) {
    const label = fieldLabels[key] ?? key;
    const seen = new Set<string>();
    for (const candidate of coupon?.couponFieldCandidates[key] ?? []) {
      for (const sample of candidate.sampleValues) {
        const raw = sample.trim();
        if (!raw) continue;
        const normalized = normalizeCouponEnumInput(key, raw);
        if (normalized === raw || seen.has(raw)) continue;
        seen.add(raw);
        notes.push(`「${label}」的“${raw}”已按标准值「${normalized}」处理`);
      }
    }
  }
  return notes;
}

export function mappingCardEnumDefaults(
  draft: CouponThreeSourcePilotDraft,
): Partial<Record<CouponFieldKey, string>> {
  const coupon = draft.recognitions.couponTable;
  const reviewAiFields = coupon?.ai?.primary
    ? (coupon.ai.result?.fieldCandidates.filter(
        (candidate) =>
          candidate.origin === "ai_inferred" || candidate.confidence < 0.85,
      ) ?? [])
    : [];
  const baseKeys = [
    ...new Set([
      ...missingOwnerFields(coupon),
      ...reviewAiFields.map((candidate) => candidate.key),
      ...validationIssueFieldKeys(draft.validationIssues),
    ]),
  ];
  const defaults: Partial<Record<CouponFieldKey, string>> = {};
  for (const key of baseKeys) {
    const choices = enumFieldChoices[key];
    if (!choices?.defaultValue) continue;
    const current = prefillOrDefault(draft, key);
    if (choices.options.some((option) => option.value === current)) continue;
    defaults[key] = choices.defaultValue;
  }
  return defaults;
}

export function buildCouponThreeSourceMappingCard(
  draft: CouponThreeSourcePilotDraft,
): FeishuCard {
  const coupon = draft.recognitions.couponTable;
  const whitelist = draft.recognitions.whitelist;
  const blacklist = draft.recognitions.blacklist;
  const whitelistDimensionChoice = identifierDimensionChoice(
    whitelist,
    "whitelist",
  );
  const blacklistDimensionChoice = identifierDimensionChoice(
    blacklist,
    "blacklist",
  );
  const coupons = combinedCouponCandidates(coupon);
  const hasUnknownCoupon = coupons.some(
    (candidate) => candidate.couponType === "unknown",
  );
  const onlyUnsupported =
    coupons.length > 0 &&
    coupons.every((candidate) => candidate.couponType === "unsupported");
  const selectedOverDeduction = overDeductionChoice(draft);
  const reviewAiFields = coupon?.ai?.primary
    ? (coupon.ai.result?.fieldCandidates.filter(
        (candidate) =>
          candidate.origin === "ai_inferred" || candidate.confidence < 0.85,
      ) ?? [])
    : [];
  const ownerReviewBaseKeys = [
    ...new Set([
      ...missingOwnerFields(coupon),
      ...reviewAiFields.map((candidate) => candidate.key),
      ...validationIssueFieldKeys(draft.validationIssues),
    ]),
  ];
  const oversizePrefillKeys = [
    ...new Set([
      ...OVERSIZE_PREFILL_BASE_KEYS,
      ...ownerReviewBaseKeys,
      ...optionalOwnerSupplementKeys,
    ]),
  ].filter((key) => isOversizePrefill(draft, key));
  const fieldsForOwnerReview = [
    ...new Set([...ownerReviewBaseKeys, ...oversizePrefillKeys]),
  ];
  // 生效推广途径（owner 覆盖 → 文案候选 → AI 候选 → 确定性候选）：
  // 公开自动推广 → 渠道必填；非公开推广 → 不渲染渠道；无法判定 → 可选。
  const effectivePromotionMode = ownerDefaultValue(draft, "promotionMode");
  const supplementRecognition = draft.supplementRecognition;
  const supplementPrefill =
    supplementRecognition?.text &&
    supplementRecognition.kind !== "form_repair" &&
    supplementRecognition.text.length <= CARD_PREFILL_MAX_LENGTH
      ? supplementRecognition.text
      : undefined;
  const supplementPrefillOversize =
    (supplementRecognition?.text?.length ?? 0) > CARD_PREFILL_MAX_LENGTH;
  const elements: Array<Record<string, unknown>> = [
    {
      tag: "markdown",
      content: [
        "第 3 步：请检查系统识别结果，并一次性补充或修改信息。",
        "可使用手机或电脑自带语音输入，把转写文字放入补充说明后先识别并回填；提交前仍可逐项修改。",
        ...(onlyUnsupported
          ? [
              "当前只识别到 P0 不支持的券型，请结束并改用受支持的常规满减券材料。",
            ]
          : []),
      ].join("\n"),
    },
    ...(enumNormalizationNotes(draft).length
      ? [
          {
            tag: "markdown",
            content: [
              "**以下表内用词已按系统标准值处理（可在下方下拉中修改）：**",
              ...enumNormalizationNotes(draft).map((note) => `- ${note}`),
            ].join("\n"),
          },
        ]
      : []),
    ...(draft.task.confirmedCalcImages.length &&
    draft.task.pendingCalcImages.length
      ? [
          {
            tag: "markdown",
            content: [
              `已确认测算图片：${draft.task.confirmedCalcImages.length} 张`,
              `待确认测算图片：${draft.task.pendingCalcImages.length} 张`,
              "检测到新上传的测算图片。请选择追加到已有图片末尾，或使用本批图片整组替换。",
            ].join("\n"),
          },
          button(draft, {
            action: "coupon_three_source_calc_images_append",
            text: "追加新测算图片",
            extra: { mode: "append" },
          }),
          button(draft, {
            action: "coupon_three_source_calc_images_replace_all",
            text: "使用本批图片替换全部",
            type: "danger",
            extra: { mode: "replace_all" },
          }),
        ]
      : []),
    ...(draft.task.confirmedCalcImages.length ||
    draft.task.pendingCalcImages.length
      ? [
          {
            tag: "markdown",
            content: [
              `已确认测算图片：${draft.task.confirmedCalcImages.length} 张`,
              `待确认测算图片：${draft.task.pendingCalcImages.length} 张`,
              ...[
                ...draft.task.confirmedCalcImages,
                ...draft.task.pendingCalcImages,
              ].map((image, index) => `${index + 1}. ${image.fileName}`),
              "寄卖/POP 将优先使用确认后的图片；若业务模式选择严选，这些图片不会进入 OA。",
            ].join("\n"),
          },
        ]
      : []),
    ...(draft.failureReason
      ? [
          {
            tag: "markdown",
            content: [
              `**上次确认未完成：** ${draft.failureReason}`,
              "已恢复本卡片，之前填写的内容已保留；修正后可直接重新提交。",
            ].join("\n"),
          },
        ]
      : []),
    ...(aiStatusContent(draft).length
      ? [
          {
            tag: "markdown",
            content: aiStatusContent(draft).join("\n"),
          },
        ]
      : []),
    ...(draft.validationIssues.some(
      (item) => item.startsWith("输入校验[") || item.startsWith("输入校验："),
    )
      ? [
          {
            tag: "markdown",
            content: [
              "**以下输入尚未通过校验：**",
              ...draft.validationIssues
                .filter(
                  (item) =>
                    item.startsWith("输入校验[") ||
                    item.startsWith("输入校验："),
                )
                .map(
                  (item) =>
                    `- ${item.replace(/^输入校验(?:\[[^\]]+\])?：/, "")}`,
                ),
              "系统会先尝试识别并回填；仍无法确定时，请按示例修改后再次提交。",
            ].join("\n"),
          },
        ]
      : []),
    ...(oversizePrefillKeys.length || supplementPrefillOversize
      ? [
          {
            tag: "markdown",
            content: [
              "**以下内容源值过长，已清空预填，请手动填写：**",
              ...oversizePrefillKeys.map(
                (key) =>
                  `- ${fieldLabels[key] ?? "业务信息"}（源值超过 ${CARD_PREFILL_MAX_LENGTH} 字符）`,
              ),
              ...(supplementPrefillOversize
                ? [`- 补充说明（原文超过 ${CARD_PREFILL_MAX_LENGTH} 字符）`]
                : []),
            ].join("\n"),
          },
        ]
      : []),
    ...(reviewAiFields.length
      ? [
          {
            tag: "markdown",
            content: [
              "**以下内容为系统推测或识别不确定，请务必检查：**",
              ...reviewAiFields.map(
                (candidate) =>
                  `- ${fieldLabels[candidate.key] ?? "业务信息"}：${clampDisplayText(ownerFieldDisplayValue(candidate.key, candidate.value ?? "待确认"))}`,
              ),
            ].join("\n"),
          },
        ]
      : []),
    {
      tag: "form",
      name: "coupon_three_source_supplement_submit",
      vertical_spacing: "12px",
      elements: [
        {
          tag: "input",
          name: "supplementText",
          label: plainText("语音或文字补充说明"),
          input_type: "multiline_text",
          rows: 4,
          required: false,
          width: "fill",
          ...(supplementPrefill ? { default_value: supplementPrefill } : {}),
        },
        {
          tag: "button",
          name: buildCouponThreeSourceRevisionedActionName({
            action: "coupon_three_source_supplement_recognition_start",
            recordId: draft.recordId,
            revision: draft.task.revision,
          }),
          text: plainText("识别补充说明并回填字段"),
          type: "default",
          width: "fill",
          form_action_type: "submit",
        },
      ],
    },
    {
      tag: "form",
      name: "coupon_three_source_mapping_submit",
      vertical_spacing: "12px",
      elements: [
        // select_static supports neither `label` nor `default_value` in the
        // Feishu card schema (either makes the whole card fail to parse with
        // 200621): field titles are markdown lines above the component, and
        // a previously stored choice is shown in the title while surviving
        // re-submission server-side (stored owner values are merged even
        // when the select is left untouched).
        {
          tag: "markdown",
          content: selectedOverDeduction
            ? `**是否超扣**（当前：${selectedOverDeduction}，如需变更请重新选择）`
            : "**是否超扣**",
        },
        {
          tag: "select_static",
          name: "owner_overDeduction",
          placeholder: plainText("请选择是否超扣"),
          required: true,
          width: "fill",
          options: [
            { text: plainText("否，不超扣"), value: "否" },
            { text: plainText("是，需要填写超扣原因"), value: "是" },
          ],
        },
        {
          tag: "input",
          name: "owner_overDeductionReason",
          label: plainText("超扣原因（选“是”时必填）"),
          input_type: "multiline_text",
          rows: 3,
          required: false,
          width: "fill",
          ...(prefillOrDefault(draft, "overDeductionReason")
            ? {
                default_value: prefillOrDefault(draft, "overDeductionReason"),
              }
            : {}),
        },
        ...(coupons.length === 0 || hasUnknownCoupon
          ? [
              {
                tag: "select_static",
                name: "couponType",
                placeholder: plainText("请确认优惠券类型"),
                required: true,
                width: "fill",
                options: [
                  {
                    text: plainText("常规满减券"),
                    value: "regular_full_reduction",
                  },
                ],
              },
            ]
          : []),
        {
          tag: "input",
          name: "activityPointPercent",
          label: plainText("OA 活动点位（%）："),
          input_type: "text",
          required: true,
          width: "fill",
        },
        { tag: "markdown", content: "**业务模式**" },
        {
          tag: "select_static",
          name: "owner_businessMode",
          placeholder: plainText("请选择业务模式"),
          required: true,
          width: "fill",
          options: [
            { text: plainText("严选"), value: "严选" },
            { text: plainText("寄卖"), value: "寄卖" },
            { text: plainText("POP"), value: "pop" },
          ],
        },
        {
          tag: "input",
          name: "owner_activityName",
          label: plainText("活动名称"),
          input_type: "text",
          ...(prefillOrDefault(draft, "activityName")
            ? { default_value: prefillOrDefault(draft, "activityName") }
            : {}),
          required: true,
          width: "fill",
        },
        {
          tag: "input",
          name: "owner_activityBackground",
          label: plainText("活动背景"),
          input_type: "multiline_text",
          rows: 3,
          ...(prefillOrDefault(draft, "activityBackground")
            ? {
                default_value: prefillOrDefault(draft, "activityBackground"),
              }
            : {}),
          required: true,
          width: "fill",
        },
        {
          tag: "input",
          name: "owner_activityStartAt",
          label: plainText("活动开始日期（YYYY-MM-DD）"),
          input_type: "text",
          ...(prefillOrDefault(draft, "activityStartAt")
            ? { default_value: prefillOrDefault(draft, "activityStartAt") }
            : {}),
          required: true,
          width: "fill",
        },
        {
          tag: "input",
          name: "owner_activityEndAt",
          label: plainText("活动结束日期（YYYY-MM-DD）"),
          input_type: "text",
          ...(prefillOrDefault(draft, "activityEndAt")
            ? { default_value: prefillOrDefault(draft, "activityEndAt") }
            : {}),
          required: true,
          width: "fill",
        },
        ...(draft.task.blacklistStatus === "absent_pending_confirmation"
          ? [
              {
                tag: "select_static",
                name: "blacklistDecision",
                placeholder: plainText("请确认本次是否无商品黑名单"),
                required: true,
                width: "fill",
                options: [
                  {
                    text: plainText("确认本次无商品黑名单"),
                    value: "absent_confirmed",
                  },
                ],
              },
            ]
          : []),
        ...fieldsForOwnerReview
          .filter(
            (key) =>
              ![
                "businessMode",
                "activityName",
                "activityBackground",
                "activityStartAt",
                "activityEndAt",
                "overDeduction",
              ].includes(key),
          )
          .map((key) => {
            const choices = enumFieldChoices[key];
            if (choices) {
              // select_static 不支持 default_value（真发验证 200621），
              // 默认值由服务端在提交时对未选择字段兜底（见
              // mappingCardEnumDefaults），卡片只用占位文案告知默认。
              const optionalWithDefault = Boolean(choices.defaultValue);
              const requiredChannel =
                key === "publicPromotionChannels" &&
                effectivePromotionMode === "公开自动推广";
              const placeholder = requiredChannel
                ? "请选择公开推广渠道（公开自动推广时必填：全网推广、单品页购物车、领券中心、公开券池）"
                : optionalWithDefault
                  ? `请选择${fieldLabels[key] ?? "选项"}（未选择按「${choices.defaultValue}」处理）`
                  : `请选择${fieldLabels[key] ?? "选项"}`;
              return {
                tag: "select_static",
                name: `owner_${key}`,
                placeholder: plainText(placeholder),
                required: requiredChannel || !optionalWithDefault,
                width: "fill",
                options: choices.options.map((option) => ({
                  text: plainText(option.text),
                  value: option.value,
                })),
              };
            }
            return {
              tag: "input",
              name: `owner_${key}`,
              label: plainText(fieldLabels[key] ?? "补充信息"),
              input_type:
                key === "activityBackground" ? "multiline_text" : "text",
              ...(key === "activityBackground" ? { rows: 3 } : {}),
              ...(prefillOrDefault(draft, key)
                ? { default_value: prefillOrDefault(draft, key) }
                : {}),
              required: true,
              width: "fill",
            };
          }),
        ...(effectivePromotionMode === "非公开推广"
          ? []
          : optionalOwnerSupplementKeys
              .filter(
                (key) =>
                  !fieldsForOwnerReview.includes(key) &&
                  !coupon?.couponFieldCandidates[key]?.some((candidate) =>
                    candidate.sampleValues.some((value) => value.trim()),
                  ) &&
                  !coupon?.ai?.result?.fieldCandidates?.some(
                    (candidate) => candidate.key === key,
                  ),
              )
              .flatMap((key): Array<Record<string, unknown>> => {
                const choices = enumFieldChoices[key];
                const required =
                  key === "publicPromotionChannels" &&
                  effectivePromotionMode === "公开自动推广";
                if (choices) {
                  return [
                    {
                      tag: "select_static",
                      name: `owner_${key}`,
                      placeholder: plainText(
                        required
                          ? `请选择${fieldLabels[key] ?? "选项"}（公开自动推广时必填）`
                          : `${fieldLabels[key] ?? "补充"}（选填）`,
                      ),
                      required,
                      width: "fill",
                      options: choices.options.map((option) => ({
                        text: plainText(option.text),
                        value: option.value,
                      })),
                    },
                  ];
                }
                return [
                  {
                    tag: "input",
                    name: `owner_${key}`,
                    label: plainText(fieldLabels[key] ?? "按业务条件补充"),
                    input_type: "text",
                    ...(prefillOrDefault(draft, key)
                      ? { default_value: prefillOrDefault(draft, key) }
                      : {}),
                    required,
                    width: "fill",
                  },
                ];
              })),
        ...(whitelist
          ? [
              {
                tag: "markdown",
                content:
                  "**商品白名单：** 已由系统识别；如摘要不正确，请重新上传源文件。",
              },
              ...(whitelistDimensionChoice?.requiresChoice
                ? identifierDimensionConfirmBlock({
                    role: "whitelist",
                    fileName: whitelist.source.fileName,
                    choice: whitelistDimensionChoice,
                  })
                : []),
            ]
          : []),
        ...(blacklist
          ? [
              {
                tag: "markdown",
                content:
                  "**商品黑名单：** 已由系统识别；如摘要不正确，请重新上传源文件。",
              },
              ...(blacklistDimensionChoice?.requiresChoice
                ? identifierDimensionConfirmBlock({
                    role: "blacklist",
                    fileName: blacklist.source.fileName,
                    choice: blacklistDimensionChoice,
                  })
                : []),
            ]
          : []),
        ...(!onlyUnsupported
          ? [
              {
                tag: "button",
                name: buildCouponThreeSourceRevisionedActionName({
                  action: "coupon_three_source_mapping_confirm",
                  recordId: draft.recordId,
                  revision: draft.task.revision,
                  mappingContextHash:
                    computeCouponThreeSourceMappingContextHash(draft),
                }),
                text: plainText("确认信息并生成标准附件"),
                type: "primary_filled",
                width: "fill",
                form_action_type: "submit",
              },
            ]
          : []),
      ],
    },
    cancelButton(draft),
  ];
  return card({
    title: "检查并补充活动信息",
    subtitle: "第 3 步：核对识别结果并补充活动信息",
    template: "orange",
    elements,
  });
}

export function buildCouponThreeSourceOverlapCard(input: {
  draft: CouponThreeSourcePilotDraft;
  count: number;
}): FeishuCard {
  return card({
    title: "白黑名单存在重叠 SKU",
    subtitle: "需要你先明确冲突处理规则，再生成标准附件",
    template: "orange",
    elements: [
      {
        tag: "markdown",
        content: `检测到 **${input.count}** 个 SKU 同时存在于白名单和黑名单。选择规则后将重新确认并生成标准附件。`,
      },
      button(input.draft, {
        action: "coupon_three_source_overlap_decide",
        text: "白名单优先",
        extra: { decision: "whitelist_wins" },
      }),
      button(input.draft, {
        action: "coupon_three_source_overlap_decide",
        text: "黑名单优先",
        extra: { decision: "blacklist_wins" },
      }),
      button(input.draft, {
        action: "coupon_three_source_overlap_decide",
        text: "返回替换源文件",
        type: "danger",
        extra: { decision: "source_replacement_required" },
      }),
      cancelButton(input.draft),
    ],
  });
}

const previewArtifactLabels = {
  couponTable: "配券表",
  productWhitelist: "白名单",
  productBlacklist: "黑名单",
  calcImage: "测算图",
} as const;

/**
 * One 👁 preview button per frozen artifact the current owner can open in
 * the Feishu client. Rendered only when the view permission grant succeeded
 * and the tenant web origin is configured; otherwise the card keeps the
 * plain file list.
 */
function previewEntryRow(
  draft: CouponThreeSourcePilotDraft,
): Record<string, unknown> | undefined {
  const baseUrl = getCouponThreeSourcePreviewWebBaseUrl();
  if (!baseUrl) return undefined;
  const granted = draft.artifacts.filter(
    (artifact: FrozenThreeSourceArtifact) =>
      artifact.previewGrantedFor === draft.ownerOpenId,
  );
  if (!granted.length) return undefined;
  return {
    tag: "column_set",
    flex_mode: "bisect",
    horizontal_spacing: "8px",
    columns: granted.map((artifact) => ({
      tag: "column",
      width: "weighted",
      weight: 1,
      elements: [
        {
          tag: "button",
          text: plainText(
            artifact.role === "calcImage"
              ? `👁 ${previewArtifactLabels[artifact.role]}${(artifact.order ?? 0) + 1}`
              : `👁 ${previewArtifactLabels[artifact.role]}`,
          ),
          type: "default",
          width: "fill",
          behaviors: [
            {
              type: "open_url",
              default_url: `${baseUrl}/file/${encodeURIComponent(artifact.fileToken)}`,
            },
          ],
        },
      ],
    })),
  };
}

export function buildCouponThreeSourcePreviewCard(
  draft: CouponThreeSourcePilotDraft,
): FeishuCard {
  const prefill = draft.oaPrefill;
  const previewRow = previewEntryRow(draft);
  return card({
    title: "标准附件已生成，待创建 OA 测试稿",
    subtitle: "请核对提报内容；确认后进入最后的发送确认",
    template: "green",
    elements: [
      {
        tag: "markdown",
        content: [
          `**提报版本：** ${draft.task.revision}`,
          `**业务模式：** ${prefill?.values.businessMode ?? "—"}`,
          `**活动名称：** ${prefill?.values.activityName ?? "—"}`,
          `**活动点位：** ${prefill?.values.activityPointPercent ?? "—"}%`,
          "**冻结标准附件：**",
          ...draft.artifacts.map(
            (artifact) =>
              `- ${artifact.fileName}（${artifact.sha256.slice(0, 12)}…）`,
          ),
          "",
          prefill?.values.businessMode === "严选"
            ? "严选不写入测算图片。"
            : `测算图片共 ${prefill?.attachments.filter((item) => item.role === "calcImage").length ?? 0} 张，顺序与上方附件一致。`,
          "确认后只会创建既有 OA 测试稿；不会自动提交正式 OA。",
        ].join("\n"),
      },
      ...(previewRow ? [previewRow] : []),
      button(draft, {
        action: "coupon_three_source_final_confirm",
        text: "确认并创建 OA 测试稿",
      }),
      cancelButton(draft),
    ],
  });
}

export function buildCouponThreeSourceCompletedCard(
  draft: CouponThreeSourcePilotDraft,
): FeishuCard {
  return card({
    title: "OA 测试稿已创建",
    subtitle: "请使用既有明确“发送”动作提交正式 OA",
    template: "green",
    content: [
      `三源提报 ${draft.pilotId.slice(0, 12)} 的 revision ${draft.task.revision} 已冻结并生成 OA 测试稿。`,
      "当前操作没有创建正式 OA；只有既有 OA 草稿中的显式“确认提交正式 OA”才会进入原生审批创建与回读 Gate。",
    ].join("\n"),
  });
}

export function buildCouponThreeSourceErrorCard(input: {
  message: string;
  /** Present when the callback context knows the draft: adds a rollback. */
  reopen?: { recordId: string; revision: number };
}): FeishuCard {
  return card({
    title: "OA 优惠券三源提报未完成",
    subtitle: "请修正材料或使用最新卡片重试",
    template: "red",
    elements: [
      { tag: "markdown", content: `**原因：** ${input.message}` },
      ...(input.reopen
        ? [
            {
              tag: "button",
              text: plainText("回到当前提报卡片重新填写"),
              type: "default",
              width: "fill",
              behaviors: [
                {
                  type: "callback",
                  value: {
                    action: "coupon_three_source_reopen",
                    pilotRecordId: input.reopen.recordId,
                    revision: input.reopen.revision,
                  },
                },
              ],
            },
          ]
        : []),
    ],
  });
}

export function buildCouponThreeSourceManualSubmissionCard(input: {
  fileName?: string;
}): FeishuCard {
  return card({
    title: "文件超过 10 MB，需转人工提报",
    subtitle: "当前自动流程未处理该文件",
    template: "orange",
    elements: [
      {
        tag: "markdown",
        content: [
          input.fileName ? `文件：${input.fileName}` : undefined,
          "当前自动流程只处理不超过 10 MB 的单个 .xlsx 文件。",
          "该文件未进入识别，也未发送给 DeepSeek；此前已接收的材料仍会保留。",
          "请改用现有人工提报渠道。系统不会自动取消当前提报，也不会声称已完成转交。",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
  });
}
