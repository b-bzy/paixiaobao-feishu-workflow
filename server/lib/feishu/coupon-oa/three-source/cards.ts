import { isPlaceholderActivityName } from "../../../coupon-oa/three-source/activity-copy";
import { canonicalCouponBusinessDate } from "../../../coupon-oa/three-source/business-date";
import type {
  CouponCandidate,
  CouponFieldKey,
} from "../../../coupon-oa/three-source/types";
import type { FeishuCard } from "../../expense-poc";
import type {
  CouponThreeSourcePilotDraft,
  StoredWorkbookRecognition,
} from "./store";

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

export function buildCouponThreeSourceClearedCard(input: {
  clearedCount: number;
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
  return card({
    title: "确认材料角色",
    subtitle: "系统无法唯一判断刚上传的 Excel",
    template: "orange",
    elements: [
      {
        tag: "markdown",
        content: [
          `**文件：** ${input.recognition.source.fileName}`,
          "请选择该文件在本次三源提报中的角色。选择后会替换同角色材料并产生新 revision。",
        ].join("\n"),
      },
      ...input.recognition.roleCandidates.map((candidate) =>
        button(input.draft, {
          action: "coupon_three_source_role_confirm",
          text:
            candidate.role === "couponTable"
              ? "作为配券表"
              : candidate.role === "whitelist"
                ? "作为商品白名单"
                : "作为商品黑名单",
          extra: { role: candidate.role },
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
    subtitle: "第 2 步：不能把未上传误当作无黑名单",
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
    subtitle: "候选识别完成后再进行第二轮确认",
    template: "blue",
    elements: [
      {
        tag: "markdown",
        content: [
          "DeepSeek 当前只识别候选，不会生成表格或创建 OA。",
          ...pending,
          "请等待最新卡片；失败时系统会回退到人工补充。",
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

function ownerFieldDisplayValue(key: CouponFieldKey, value: unknown): string {
  if (key === "activityStartAt" || key === "activityEndAt") {
    return canonicalCouponBusinessDate(value) ?? String(value);
  }
  return Array.isArray(value) ? value.join("、") : String(value);
}

function ownerDefaultValue(
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

function missingOwnerFields(
  recognition: StoredWorkbookRecognition | undefined,
): CouponFieldKey[] {
  if (!recognition) return [...ownerSupplementKeys];
  return ownerSupplementKeys.filter(
    (key) =>
      !recognition.couponFieldCandidates[key]?.some((candidate) =>
        candidate.sampleValues.some((value) => value.trim()),
      ) &&
      !recognition.ai?.result?.fieldCandidates.some(
        (candidate) => candidate.key === key,
      ),
  );
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

export function buildCouponThreeSourceMappingCard(
  draft: CouponThreeSourcePilotDraft,
): FeishuCard {
  const coupon = draft.recognitions.couponTable;
  const whitelist = draft.recognitions.whitelist;
  const blacklist = draft.recognitions.blacklist;
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
  const fieldsForOwnerReview = [
    ...new Set([
      ...missingOwnerFields(coupon),
      ...reviewAiFields.map((candidate) => candidate.key),
    ]),
  ];
  const elements: Array<Record<string, unknown>> = [
    {
      tag: "markdown",
      content: [
        "第二轮：请检查系统识别结果，并一次性补充或修改信息。",
        "可使用手机或电脑自带语音输入，把转写文字放入补充说明后先识别并回填；提交前仍可逐项修改。",
        ...(onlyUnsupported
          ? [
              "当前只识别到 P0 不支持的券型，请结束并改用受支持的常规满减券材料。",
            ]
          : []),
      ].join("\n"),
    },
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
    ...(reviewAiFields.length
      ? [
          {
            tag: "markdown",
            content: [
              "**以下内容为系统推测或识别不确定，请务必检查：**",
              ...reviewAiFields.map(
                (candidate) =>
                  `- ${fieldLabels[candidate.key] ?? "业务信息"}：${ownerFieldDisplayValue(candidate.key, candidate.value ?? "待确认")}`,
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
          required: true,
          width: "fill",
          ...(draft.supplementRecognition?.text &&
          draft.supplementRecognition.kind !== "form_repair"
            ? { default_value: draft.supplementRecognition.text }
            : {}),
        },
        {
          tag: "button",
          name: `coupon_three_source_supplement_recognition_start:${draft.recordId}:${draft.task.revision}`,
          text: plainText("识别补充说明并回填字段"),
          type: "default",
          width: "fill",
          form_action_type: "submit",
        },
      ],
    },
    {
      tag: "markdown",
      content: `**是否超扣：** ${selectedOverDeduction ?? "待确认"}\n选择“是”后才会显示并要求填写超扣原因。`,
    },
    button(draft, {
      action: "coupon_three_source_over_deduction_select",
      text: "否，不超扣",
      type: selectedOverDeduction === "否" ? "primary_filled" : "default",
      extra: { decision: "否" },
    }),
    button(draft, {
      action: "coupon_three_source_over_deduction_select",
      text: "是，需要填写超扣原因",
      type: selectedOverDeduction === "是" ? "primary_filled" : "default",
      extra: { decision: "是" },
    }),
    {
      tag: "form",
      name: "coupon_three_source_mapping_submit",
      vertical_spacing: "12px",
      elements: [
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
          ...(ownerDefaultValue(draft, "activityName")
            ? { default_value: ownerDefaultValue(draft, "activityName") }
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
          ...(ownerDefaultValue(draft, "activityBackground")
            ? {
                default_value: ownerDefaultValue(draft, "activityBackground"),
              }
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
                "overDeduction",
              ].includes(key),
          )
          .map((key) => ({
            ...(key === "businessMode"
              ? {
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
                }
              : {
                  tag: "input",
                  name: `owner_${key}`,
                  label: plainText(fieldLabels[key] ?? "补充信息"),
                  input_type:
                    key === "activityBackground" ? "multiline_text" : "text",
                  ...(key === "activityBackground" ? { rows: 3 } : {}),
                  ...(ownerDefaultValue(draft, key)
                    ? { default_value: ownerDefaultValue(draft, key) }
                    : {}),
                  required: true,
                  width: "fill",
                }),
          })),
        ...(selectedOverDeduction === "是"
          ? [
              {
                tag: "input",
                name: "owner_overDeductionReason",
                label: plainText("超扣原因"),
                input_type: "multiline_text",
                rows: 3,
                required: true,
                width: "fill",
                ...(ownerDefaultValue(draft, "overDeductionReason")
                  ? {
                      default_value: ownerDefaultValue(
                        draft,
                        "overDeductionReason",
                      ),
                    }
                  : {}),
              },
            ]
          : []),
        ...optionalOwnerSupplementKeys
          .filter(
            (key) =>
              !coupon?.couponFieldCandidates[key]?.some((candidate) =>
                candidate.sampleValues.some((value) => value.trim()),
              ) &&
              !coupon?.ai?.result?.fieldCandidates.some(
                (candidate) => candidate.key === key,
              ),
          )
          .map((key) => ({
            tag: "input",
            name: `owner_${key}`,
            label: plainText(fieldLabels[key] ?? "按业务条件补充"),
            input_type: "text",
            ...(ownerDefaultValue(draft, key)
              ? { default_value: ownerDefaultValue(draft, key) }
              : {}),
            required: false,
            width: "fill",
          })),
        ...(whitelist
          ? [
              {
                tag: "markdown",
                content:
                  "**商品白名单：** 已由系统识别；如摘要不正确，请重新上传源文件。",
              },
            ]
          : []),
        ...(blacklist
          ? [
              {
                tag: "markdown",
                content:
                  "**商品黑名单：** 已由系统识别；如摘要不正确，请重新上传源文件。",
              },
            ]
          : []),
        ...(!onlyUnsupported
          ? [
              {
                tag: "button",
                name: `coupon_three_source_mapping_confirm:${draft.recordId}:${draft.task.revision}`,
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
    subtitle: "第二轮：系统识别结果与业务确认",
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
    subtitle: "第 4 步：必须明确冲突处理规则",
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

export function buildCouponThreeSourcePreviewCard(
  draft: CouponThreeSourcePilotDraft,
): FeishuCard {
  const prefill = draft.oaPrefill;
  return card({
    title: "标准附件已生成，待创建 OA 测试稿",
    subtitle: "第 5 步：确认当前 revision",
    template: "green",
    elements: [
      {
        tag: "markdown",
        content: [
          `**版本：** revision ${draft.task.revision}`,
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
}): FeishuCard {
  return card({
    title: "OA 优惠券三源提报未完成",
    subtitle: "请修正材料或使用最新卡片重试",
    template: "red",
    content: `**原因：** ${input.message}`,
  });
}
